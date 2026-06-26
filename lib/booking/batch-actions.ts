"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { startOfDay } from "date-fns";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";
import { solveDay, type SolverBookingInput, type TjwCommitment } from "@/lib/booking/batch-solver";
import { driverVehicleMap } from "@/lib/booking/fleet";
import { loadWeightedEarnings } from "@/lib/booking/earnings";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";
import type { DriverRotationState, ScheduledTrip } from "@/lib/booking/rotations";
import type { ActionResult } from "@/lib/booking/actions";
import type { JobType } from "@prisma/client";

const runBatchSchema = z.object({
  date: z.string().min(8), // YYYY-MM-DD
});

/**
 * CR-07: solve the whole day's APPROVED bookings in one batch and persist
 * the resulting assignments + overflow reasons. Bookings flip to ASSIGNED
 * on success; overflow rows keep status APPROVED but get an
 * `overflowReason` set so Khun Top can resolve them by hand.
 *
 * Provisional rotation stamping (Update 10 of the change log): we bump
 * `lastTjwAt` / `lastOtAt` / `lastDutyAt` here so a re-run on the same
 * day doesn't double-pick the same driver. The cancellation flow rolls
 * the stamp back; completion is the final signal.
 */
export async function runBatchAction(formData: FormData): Promise<ActionResult & { stats?: BatchStats }> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const parsed = runBatchSchema.safeParse({ date: formData.get("date") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const date = new Date(`${parsed.data.date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { ok: false, error: te("invalidInput") };
  const dayStart = startOfDay(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // --- Pending bookings for the day (APPROVED, no primary yet). ---
  // TJW is no longer assigned here — it goes through the global request-order
  // pass (assignTjwByRequestOrder); the daily batch handles OT/WERN/NORMAL and
  // sees TJW-committed drivers as away via activeTjwCommitments.
  const pending = await prisma.booking.findMany({
    where: {
      status: "APPROVED",
      primaryDriverId: null,
      jobType: { not: "TJW" },
      startAt: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { createdAt: "asc" },
  });

  // --- Driver pool + rotation snapshots. ---
  const drivers = await prisma.driver.findMany({
    // Gate on the owning User's isActive too: deactivating a user is how a
    // driver is "removed", and Driver.isActive is never toggled on its own.
    // Also skip anyone marked off for the day (sick / leave) — fairness +
    // rotation self-heal on return, so nothing else needs to change.
    where: {
      isActive: true,
      user: { is: { isActive: true } },
      unavailabilities: { none: { date: dayStart } },
    },
    select: {
      id: true,
      lastTjwAt: true,
      lastOtAt: true,
      lastDutyAt: true,
      lastAssignedAt: true,
    },
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

  // --- Duty driver for the day (from OnCallShift). Validated against the active
  // + paired pool below (a deactivated/unpaired duty driver is a ghost). ---
  const onCall = await prisma.onCallShift.findUnique({ where: { date: dayStart } });
  const onCallDriverId = onCall?.driverId ?? null;

  // --- Active TJW commitments (multi-day TJW trips that span today). ---
  const tjwSpanning = await prisma.booking.findMany({
    where: {
      jobType: "TJW",
      // Include APPROVED: a TJW claimed via the board matcher stays APPROVED but
      // its driver is genuinely away — must still lock them out of a new trip.
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

  // --- Convert pending bookings into solver inputs. ---
  const solverBookings: SolverBookingInput[] = pending.map((b) => ({
    bookingId: b.id,
    jobType: b.jobType,
    startAt: b.startAt,
    endAt: b.endAt,
    estimatedDistance: b.estimatedDistance,
    outOfProvince: b.outOfProvince,
    submittedAt: b.createdAt,
  }));

  // car=driver: a booking's vehicle is its PRIMARY driver's assigned car
  // (Vehicle.assignedDriverId). No independent slot search — picking the
  // driver already picked the car.
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    select: { id: true, assignedDriverId: true },
  });
  const driverCar = driverVehicleMap(vehicles);

  // car=driver: a driver with no assigned car can't be dispatched, so keep them
  // out of the pick pool entirely — otherwise the solver may pick an unpaired
  // (e.g. just-added) driver and overflow the booking NO_SLOT while a paired,
  // lower-ranked driver sits idle.
  const pairedDriverStates = driverStates.filter((d) => driverCar.has(d.driverId));
  if (pairedDriverStates.length === 0) return { ok: false, error: te("noActiveDrivers") };
  // An OnCallShift pointing at a driver who is no longer active+paired is a ghost
  // — null it so WERN falls back to the duty rotation (oldest lastDutyAt).
  const dutyDriverId =
    onCallDriverId && pairedDriverStates.some((d) => d.driverId === onCallDriverId)
      ? onCallDriverId
      : null;

  // --- Trips already on a car for this day (any job type). ---
  // Seeds each driver's schedule so the solver can't stack a second trip on an
  // already-booked car (overlap) or blow past the daily cap. Spanning TJW from
  // yesterday is included via the startAt<dayEnd && endAt>dayStart window.
  const assignedToday = await prisma.booking.findMany({
    where: {
      // APPROVED-with-driver (board-claimed) trips occupy the car too — without
      // them the solver would stack a second trip on an already-claimed car.
      status: { in: COMMITTED_STATUSES },
      primaryDriverId: { not: null },
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
    },
    select: { id: true, startAt: true, endAt: true, jobType: true, primaryDriverId: true, secondaryDriverId: true },
  });
  const existingByDriver = new Map<string, ScheduledTrip[]>();
  const addTrip = (driverId: string | null, t: { id: string; startAt: Date; endAt: Date; jobType: JobType }) => {
    if (!driverId) return;
    const list = existingByDriver.get(driverId) ?? [];
    list.push({ id: t.id, startAt: t.startAt, endAt: t.endAt, jobType: t.jobType });
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

  // Bind each assignment to its primary driver's car. A driver with no car
  // (an unpaired vehicle) can't be dispatched → NO_SLOT overflow. The co-driver
  // (secondary) rides along in the primary's car — no second vehicle dispatched.
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

      // Provisional rotation stamping: same-day re-runs need stamps to
      // already-be-bumped so the same driver isn't double-picked.
      const stamp = booking.startAt;
      await stampPrimary(tx, a.primaryDriverId, a.jobType, stamp);
      if (a.secondaryDriverId) {
        await stampSecondary(tx, a.secondaryDriverId, a.jobType, stamp);
      }

      await logTransition({
        bookingId: a.bookingId,
        actorUserId: (await requireRole("ADMIN")).user.id,
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
    // Solver matched these, but no vehicle was free in their bucket → surface as
    // NO_SLOT overflow rather than a driver with no car. Not assigned, not stamped.
    for (const a of noVehicle) {
      await tx.booking.update({
        where: { id: a.bookingId },
        data: { overflowReason: "NO_SLOT" },
      });
    }
    for (const o of result.overflows) {
      await tx.booking.update({
        where: { id: o.bookingId },
        data: { overflowReason: o.reason },
      });
    }
  });

  revalidatePath("/admin");
  revalidatePath("/admin/batch");
  revalidatePath("/driver/board");

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

export interface BatchStats {
  pendingCount: number;
  matchedCount: number;
  overflowByReason: Record<string, number>;
}

function tallyOverflows(overflows: { reason: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of overflows) out[o.reason] = (out[o.reason] ?? 0) + 1;
  return out;
}

// ---- helpers ----

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
  // Secondaries share the same category-rotation stamp so the next batch
  // sees them as recently-used.
  await stampPrimary(tx, driverId, jobType, stamp);
}

// ---- CR-07 Update 10: cancellation rollback ----
//
// When a booking is cancelled (or its assignment is undone), the driver's
// category-rotation stamp must be cleared back to the previous trip in
// that category. Called by extra-actions.cancelBookingAction.
export async function rollbackRotationStampsForBooking(bookingId: string): Promise<void> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      primaryDriverId: true,
      secondaryDriverId: true,
      jobType: true,
      startAt: true,
    },
  });
  if (!b) return;
  const targets = [b.primaryDriverId, b.secondaryDriverId].filter((id): id is string => !!id);
  for (const driverId of targets) {
    await recomputeRotationStamp(driverId, b.jobType);
  }
}

// ---- Resolve NEEDS_WERN_RECLAIM_DECISION overflow ----
//
// Khun Top picks one of two options:
//   RECLAIM_WERN — re-assign the duty driver to this trip; ops handles
//     the standing campus rounds by hand for the day.
//   OUTSOURCE    — keep the duty driver on WERN, mark the trip for
//     outsourcing. The OutsourceForm picks up from here.
const resolveSchema = z.object({
  bookingId: z.string().min(1),
  decision: z.enum(["RECLAIM_WERN", "OUTSOURCE"]),
});

export async function resolveReclaimAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;
  const te = await getTranslations("errors");

  const parsed = resolveSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, decision } = parsed.data;
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      overflowReason: null,
      escalatedToKhunTop: decision === "OUTSOURCE",
      needsOutsourcing: decision === "OUTSOURCE",
    },
  });
  await logTransition({
    bookingId,
    actorUserId: adminId,
    fromStatus: booking.status,
    toStatus: booking.status,
    action: "RECLAIM_DECISION",
    metadata: { decision },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/batch");
  return { ok: true };
}
