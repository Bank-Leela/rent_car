import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { logTransition } from "@/lib/booking/audit";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";
import { solveDay, type SolverBookingInput, type TjwCommitment } from "@/lib/booking/batch-solver";
import { driverVehicleMap } from "@/lib/booking/fleet";
import { loadWeightedEarnings } from "@/lib/booking/earnings";
import type { DriverRotationState, ScheduledTrip } from "@/lib/booking/rotations";
import type { ActionResult } from "@/lib/booking/actions";
import type { JobType } from "@prisma/client";

export interface BatchStats {
  pendingCount: number;
  matchedCount: number;
  overflowByReason: Record<string, number>;
}

/**
 * CR-07 core: solve one day's APPROVED bookings and persist assignments +
 * overflow reasons. Plain function (NOT a server action) so it can be called
 * both by the ADMIN-gated `runBatchAction` and by the secret-gated daily cron
 * route — `actorUserId` is supplied by the caller (the admin, or a resolved
 * admin for the automated run) since this layer does no auth of its own.
 *
 * Bookings flip to ASSIGNED on success; overflow rows keep status APPROVED but
 * get an `overflowReason` set. Provisional rotation stamping bumps
 * lastTjwAt/lastOtAt/lastDutyAt so a same-day re-run doesn't double-pick.
 */
export async function runBatchForDay(
  dateStr: string,
  actorUserId: string,
): Promise<ActionResult & { stats?: BatchStats }> {
  const te = await getTranslations("errors");
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { ok: false, error: te("invalidInput") };
  const dayStart = startOfDay(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // --- Pending bookings for the day (APPROVED, no primary yet). ---
  const pending = await prisma.booking.findMany({
    where: {
      status: "APPROVED",
      primaryDriverId: null,
      // Urgent requests stay APPROVED for manual matching.
      isEmergency: false,
      // SMUS = external charter; TJW goes through assignTjwByRequestOrder;
      // BUS_OUTSOURCED = outsourced rental — all excluded from the daily batch.
      jobType: { notIn: ["SMUS", "TJW"] },
      preferredVehicleType: { not: "BUS_OUTSOURCED" },
      startAt: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { createdAt: "asc" },
  });

  // --- Driver pool + rotation snapshots (skip inactive + marked-off). ---
  const drivers = await prisma.driver.findMany({
    where: {
      isActive: true,
      user: { is: { isActive: true } },
      unavailabilities: { none: { date: dayStart } },
    },
    select: { id: true, lastTjwAt: true, lastOtAt: true, lastDutyAt: true, lastAssignedAt: true },
  });
  if (drivers.length === 0) return { ok: false, error: te("noActiveDrivers") };

  const earnings = await loadWeightedEarnings(drivers.map((d) => d.id));
  const driverStates: DriverRotationState[] = drivers.map((d) => ({
    driverId: d.id,
    lastTjwAt: d.lastTjwAt,
    lastOtAt: d.lastOtAt,
    lastDutyAt: d.lastDutyAt,
    lastAssignedAt: d.lastAssignedAt,
    earningsScore: earnings.get(d.id) ?? 0,
  }));

  const onCall = await prisma.onCallShift.findUnique({ where: { date: dayStart } });
  const onCallDriverId = onCall?.driverId ?? null;

  // --- Active TJW commitments (multi-day TJW spanning this day). ---
  const tjwSpanning = await prisma.booking.findMany({
    where: {
      jobType: "TJW",
      status: { in: COMMITTED_STATUSES },
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
    },
    select: { primaryDriverId: true, secondaryDriverId: true, startAt: true, endAt: true },
  });
  const commitments: TjwCommitment[] = [];
  for (const t of tjwSpanning) {
    if (t.primaryDriverId) commitments.push({ driverId: t.primaryDriverId, startAt: t.startAt, endAt: t.endAt });
    if (t.secondaryDriverId) commitments.push({ driverId: t.secondaryDriverId, startAt: t.startAt, endAt: t.endAt });
  }

  const solverBookings: SolverBookingInput[] = pending.map((b) => ({
    bookingId: b.id,
    jobType: b.jobType,
    startAt: b.startAt,
    endAt: b.endAt,
    estimatedDistance: b.estimatedDistance,
    needsSecondaryDriver: b.needsSecondaryDriver,
    outOfProvince: b.outOfProvince,
    submittedAt: b.createdAt,
    waitAtDestination: b.waitAtDestination,
    dropOffDone: b.dropOffDone,
    pickupReturnTime: b.pickupReturnTime,
  }));

  // car=driver: a booking's vehicle is its PRIMARY driver's assigned car.
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    select: { id: true, assignedDriverId: true },
  });
  const driverCar = driverVehicleMap(vehicles);

  // A driver with no assigned car can't be dispatched → keep them out of the pool.
  const pairedDriverStates = driverStates.filter((d) => driverCar.has(d.driverId));
  if (pairedDriverStates.length === 0) return { ok: false, error: te("noActiveDrivers") };
  const dutyDriverId =
    onCallDriverId && pairedDriverStates.some((d) => d.driverId === onCallDriverId)
      ? onCallDriverId
      : null;

  // --- Trips already on a car for this day (seed the solver's schedule). ---
  const assignedToday = await prisma.booking.findMany({
    where: {
      status: { in: COMMITTED_STATUSES },
      primaryDriverId: { not: null },
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
    },
    select: {
      id: true, startAt: true, endAt: true, jobType: true, primaryDriverId: true, secondaryDriverId: true,
      waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
    },
  });
  const existingByDriver = new Map<string, ScheduledTrip[]>();
  const addTrip = (
    driverId: string | null,
    t: {
      id: string; startAt: Date; endAt: Date; jobType: JobType;
      waitAtDestination: boolean; dropOffDone: Date | null; pickupReturnTime: string | null;
    },
  ) => {
    if (!driverId) return;
    const list = existingByDriver.get(driverId) ?? [];
    list.push({
      id: t.id, startAt: t.startAt, endAt: t.endAt, jobType: t.jobType,
      waitAtDestination: t.waitAtDestination, dropOffDone: t.dropOffDone, pickupReturnTime: t.pickupReturnTime,
    });
    existingByDriver.set(driverId, list);
  };
  for (const t of assignedToday) {
    addTrip(t.primaryDriverId, t);
    addTrip(t.secondaryDriverId, t);
  }

  const result = solveDay({
    date,
    bookings: solverBookings,
    drivers: pairedDriverStates,
    dutyDriverId,
    activeTjwCommitments: commitments,
    existingByDriver,
  });

  // Bind each assignment to its primary driver's car.
  const withVehicle: { item: (typeof result.assignments)[number]; vehicleId: string }[] = [];
  const noVehicle: typeof result.assignments = [];
  for (const a of result.assignments) {
    const vehicleId = driverCar.get(a.primaryDriverId) ?? null;
    if (vehicleId) withVehicle.push({ item: a, vehicleId });
    else noVehicle.push(a);
  }

  // --- Persist assignments + bump rotation timestamps + record overflow. ---
  await prisma.$transaction(async (tx) => {
    for (const { item: a, vehicleId } of withVehicle) {
      const booking = pending.find((p) => p.id === a.bookingId)!;
      await tx.booking.update({
        where: { id: a.bookingId },
        data: {
          primaryDriverId: a.primaryDriverId,
          secondaryDriverId: a.secondaryDriverId,
          vehicleId,
          status: "ASSIGNED",
          driverScheduleStatus: "CONFIRMED",
          decidedAt: new Date(),
          overflowReason: null,
          escalatedToKhunTop: false,
        },
      });

      const stamp = booking.startAt;
      await stampPrimary(tx, a.primaryDriverId, a.jobType, stamp);
      if (a.secondaryDriverId) {
        await stampSecondary(tx, a.secondaryDriverId, a.jobType, stamp);
      }

      await logTransition({
        bookingId: a.bookingId,
        actorUserId,
        fromStatus: "APPROVED",
        toStatus: "ASSIGNED",
        action: "BATCH_MATCHED",
        metadata: {
          primaryDriverId: a.primaryDriverId,
          secondaryDriverId: a.secondaryDriverId,
          jobType: a.jobType,
        },
        tx,
      });
    }
    // Solver matched but no free car in the bucket → NO_SLOT overflow.
    for (const a of noVehicle) {
      await tx.booking.update({ where: { id: a.bookingId }, data: { overflowReason: "NO_SLOT" } });
    }
    for (const o of result.overflows) {
      await tx.booking.update({ where: { id: o.bookingId }, data: { overflowReason: o.reason } });
    }
  });

  revalidatePath("/admin");
  revalidatePath("/admin/batch");

  const stats: BatchStats = {
    pendingCount: pending.length,
    matchedCount: withVehicle.length,
    overflowByReason: tallyOverflows([
      ...result.overflows,
      ...noVehicle.map(() => ({ reason: "NO_SLOT" })),
    ]),
  };
  return { ok: true, stats };
}

function tallyOverflows(overflows: { reason: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of overflows) out[o.reason] = (out[o.reason] ?? 0) + 1;
  return out;
}

async function stampPrimary(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  driverId: string,
  jobType: JobType,
  stamp: Date,
) {
  const data: { lastAssignedAt: Date; lastTjwAt?: Date; lastOtAt?: Date; lastDutyAt?: Date } = {
    lastAssignedAt: stamp,
  };
  if (jobType === "TJW") data.lastTjwAt = stamp;
  else if (jobType === "OT") data.lastOtAt = stamp;
  else if (jobType === "WERN") data.lastDutyAt = stamp;
  await tx.driver.update({ where: { id: driverId }, data });
}

async function stampSecondary(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  driverId: string,
  jobType: JobType,
  stamp: Date,
) {
  // Secondaries share the same category-rotation stamp.
  await stampPrimary(tx, driverId, jobType, stamp);
}
