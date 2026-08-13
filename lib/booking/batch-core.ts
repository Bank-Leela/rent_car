import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { logTransition } from "@/lib/booking/audit";
import { isExclusionViolation } from "@/lib/booking/db-errors";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";
import { solveDay, type SolverBookingInput, type TjwCommitment } from "@/lib/booking/batch-solver";
import { driverVehicleMap } from "@/lib/booking/fleet";
import { loadWeightedEarnings } from "@/lib/booking/earnings";
import type { DriverRotationState, ScheduledTrip } from "@/lib/booking/rotations";
import type { ActionResult } from "@/lib/booking/actions";
import type { JobType, Prisma } from "@prisma/client";

export interface BatchStats {
  pendingCount: number;
  matchedCount: number;
  overflowByReason: Record<string, number>;
}

/**
 * What the daily batch can actually place — everything except the date bounds.
 *
 * Exported because the cron's "which days still need solving?" sweep has to ask
 * the SAME question. It used to ask a broader one (just APPROVED with no driver),
 * so a booking the solver deliberately never touches — จองเร่งด่วน, SMUS charter,
 * TJW, an outsourced bus — kept its day on the outstanding list permanently. The
 * sweep re-solved that day every night, the solver skipped the booking every
 * time, and the day could never clear: each such booking added a day to the
 * nightly run for good, so the sweep only ever grew.
 *
 * One definition, two callers. Duplicating the predicate is what caused this.
 */
export const BATCH_SOLVABLE_WHERE = {
  status: "APPROVED",
  primaryDriverId: null,
  // Urgent requests stay APPROVED for manual matching.
  isEmergency: false,
  // SMUS = external charter; TJW goes through assignTjwByRequestOrder;
  // BUS_OUTSOURCED = outsourced rental — all excluded from the daily batch.
  jobType: { notIn: ["SMUS", "TJW"] },
  preferredVehicleType: { not: "BUS_OUTSOURCED" },
} as const satisfies Prisma.BookingWhereInput;

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
      ...BATCH_SOLVABLE_WHERE,
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
  //
  // ONE TRANSACTION PER ASSIGNMENT, not one for the whole day.
  //
  // This used to be a single transaction wrapping the entire loop, with no
  // try/catch anywhere in the file. The occupancy EXCLUDE raises 23P01 when a
  // write would double-book a car, so one conflicting booking rolled back every
  // assignment already made for that day AND recorded no overflow reason to
  // explain it — P'Top pressed จัดรอบ, got an opaque failure, and the board looked
  // untouched. Worse on the nightly cron: the uncaught throw escaped the per-day
  // loop in the sweep route, so every day later in the sweep was silently never
  // scheduled at all.
  //
  // Per-assignment is also what the contract in this file's docstring already
  // describes: bookings flip to ASSIGNED on success, and what cannot be placed
  // keeps APPROVED with an `overflowReason`. A car the DB says is taken is exactly
  // that case, so it becomes an overflow row instead of taking its siblings down.
  // The booking update and its rotation stamps stay atomic together, which is the
  // only grouping that actually matters — a stamped driver must always have the
  // trip that stamped them.
  let conflicted = 0;
  for (const { item: a, vehicleId } of withVehicle) {
    const booking = pending.find((p) => p.id === a.bookingId)!;
    try {
      await prisma.$transaction(async (tx) => {
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
      });
    } catch (err) {
      if (!isExclusionViolation(err)) throw err;
      // The solver believed this car was free and the DB disagrees — a stale
      // read, or another admin assigning the same car while the batch ran.
      // Record it the way any other unplaceable trip is recorded rather than
      // failing the day.
      conflicted++;
      noVehicle.push(a);
      console.warn(
        `[batch] ${dateStr}: ${a.bookingId} lost its car to a conflict; left as NO_SLOT overflow`,
      );
    }
  }

  // Overflow marks are independent single-row writes; one failing must not undo
  // the others, and none of them can trip the occupancy constraint.
  for (const a of noVehicle) {
    await prisma.booking.update({ where: { id: a.bookingId }, data: { overflowReason: "NO_SLOT" } });
  }
  for (const o of result.overflows) {
    await prisma.booking.update({ where: { id: o.bookingId }, data: { overflowReason: o.reason } });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/batch");

  const stats: BatchStats = {
    pendingCount: pending.length,
    // Minus the ones the DB refused: they were attempted, not matched, and they
    // are already counted as NO_SLOT overflow below.
    matchedCount: withVehicle.length - conflicted,
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
