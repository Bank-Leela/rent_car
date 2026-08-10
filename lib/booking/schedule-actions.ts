"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";
import { legsOverlap, type LegSource } from "@/lib/booking/trip-legs";
import { isExclusionViolation } from "@/lib/booking/db-errors";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";

// Adapt a booking row to the leg helper (no-wait trips free their middle).
type LegRow = { startAt: Date; endAt: Date; waitAtDestination: boolean; dropOffDone: Date | null; pickupReturnTime: string | null };
const toLegSrc = (b: LegRow): LegSource => ({
  startAt: b.startAt,
  endAt: b.endAt,
  waitAtDestination: b.waitAtDestination,
  dropOffDone: b.dropOffDone,
  pickupReturnTime: b.pickupReturnTime,
});

// car=driver: dropping a booking on a car assigns the car AND its assigned
// driver. Blocks only if the car is already booked at that time, or the car has
// no assigned driver. The board maps the error code to a message.
// On a `vehicleBusy` block, the conflicting trip(s) ride back so the board can
// name them — vital for a multi-day trip whose clash is on a day not on screen.
export type ReassignConflict = { jobNumber: string; startAt: Date; endAt: Date };
type ReassignResult =
  | { ok: false; error: string; conflicts?: ReassignConflict[] }
  | { ok: true };

export async function reassignVehicleAction(formData: FormData): Promise<ReassignResult> {
  await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  // Optional co-driver for >400km trips (recommendation-assign). Only set when
  // explicitly passed, so a plain drag-drop never clears an existing co-driver.
  const secondaryDriverIdIn = String(formData.get("secondaryDriverId") ?? "") || null;
  if (!bookingId || !vehicleId) return { ok: false, error: "invalidInput" };

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "bookingNotFound" };
  // External charter (SMUS) — outside buses/vans, not placed on an internal car.
  if (booking.jobType === "SMUS") return { ok: false, error: "externalCharterNoMatch" };
  // Outsourced-rental bus — same as SMUS, never placed on an internal car.
  if (booking.preferredVehicleType === "BUS_OUTSOURCED") {
    return { ok: false, error: "outsourcedVehicleNoMatch" };
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      assignedDriverId: true,
      assignedDriver: { select: { isActive: true, user: { select: { isActive: true } } } },
    },
  });
  // A deactivated driver (or one whose user was deactivated) can't be dispatched,
  // so treat their car as driverless rather than assigning a "removed" driver.
  if (
    !vehicle?.assignedDriverId ||
    !vehicle.assignedDriver?.isActive ||
    !vehicle.assignedDriver.user?.isActive
  ) {
    return { ok: false, error: "noAssignedDriver" };
  }

  // No overlap, ever — on EVERY car, including the duty car. A manual override
  // (drag / assign-reco) may relax the 2h chaining gap and may put a trip on a
  // driver marked off (sick/leave) — both are deliberate P'Top overrides, not
  // blocked here; only AUTO-assign honors those. It must never double-book a car.
  // Skip only when re-dropping on the same car (a booking can't collide with
  // itself; the query already excludes its own id).
  if (vehicleId !== booking.vehicleId) {
    // SQL window-overlap is a coarse PREFILTER (superset of leg-overlap); refine
    // per-leg in JS so a trip that only fits a no-wait trip's freed middle is not
    // flagged as a conflict.
    const candidates = await prisma.booking.findMany({
      where: {
        id: { not: bookingId },
        vehicleId,
        // Match the DB occupancy trigger (APPROVED|ASSIGNED|COMPLETED). Without
        // COMPLETED here the pre-check misses a finished trip that still holds an
        // occupancy row, so the drop is rejected by the EXCLUDE with an UNNAMED
        // vehicleBusy instead of a named conflict.
        status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
        startAt: { lt: booking.endAt },
        endAt: { gt: booking.startAt },
      },
      orderBy: { startAt: "asc" },
      select: {
        jobNumber: true, startAt: true, endAt: true,
        waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
      },
    });
    const bookingLeg = toLegSrc(booking);
    const conflicts = candidates
      .filter((c) => legsOverlap(bookingLeg, toLegSrc(c)))
      .slice(0, 3)
      .map((c) => ({ jobNumber: c.jobNumber, startAt: c.startAt, endAt: c.endAt }));
    if (conflicts.length > 0) return { ok: false, error: "vehicleBusy", conflicts };
  }

  const driverId = vehicle.assignedDriverId;
  // A driver can't be in two places at once. The per-vehicle check + DB EXCLUDE
  // above only guard the TARGET CAR, but this car's assigned driver may already
  // be riding as a CO-DRIVER in ANOTHER car's trip (a co-driver rides in the
  // primary's car, so their own car stays free and neither guard catches it —
  // docs/scheduling-algorithm.md §5). Reject an overlapping commitment on any
  // OTHER car. Overlap on a driver is never override-relaxable (unlike the 2h gap).
  {
    const elsewhere = await prisma.booking.findMany({
      where: {
        id: { not: bookingId },
        vehicleId: { not: vehicleId }, // the target car's own trips are checked above
        status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
        OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
        startAt: { lt: booking.endAt },
        endAt: { gt: booking.startAt },
      },
      orderBy: { startAt: "asc" },
      select: {
        jobNumber: true, startAt: true, endAt: true,
        waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
      },
    });
    const bookingLeg = toLegSrc(booking);
    const driverConflicts = elsewhere
      .filter((c) => legsOverlap(bookingLeg, toLegSrc(c)))
      .slice(0, 3)
      .map((c) => ({ jobNumber: c.jobNumber, startAt: c.startAt, endAt: c.endAt }));
    if (driverConflicts.length > 0) return { ok: false, error: "vehicleBusy", conflicts: driverConflicts };
  }
  // Re-validate the recommended co-driver: it was picked as free at render time,
  // but could have been booked since. Drop it (place primary only) if it now has
  // an overlapping trip — never silently double-book the co-driver.
  let secondary = secondaryDriverIdIn && secondaryDriverIdIn !== driverId ? secondaryDriverIdIn : null;
  if (secondary) {
    // The co-driver may have been deactivated between render and assign — never
    // assign a removed driver as secondary.
    const secActive = await prisma.driver.findFirst({
      where: { id: secondary, isActive: true, user: { is: { isActive: true } } },
      select: { id: true },
    });
    if (!secActive) secondary = null;
  }
  if (secondary) {
    // Coarse window-overlap prefilter, then refine per-leg: the co-driver is only
    // busy if a LEG of one of their trips overlaps a leg of this trip.
    const secCandidates = await prisma.booking.findMany({
      where: {
        id: { not: bookingId },
        status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
        OR: [{ primaryDriverId: secondary }, { secondaryDriverId: secondary }],
        startAt: { lt: booking.endAt },
        endAt: { gt: booking.startAt },
      },
      select: { startAt: true, endAt: true, waitAtDestination: true, dropOffDone: true, pickupReturnTime: true },
    });
    const bookingLeg = toLegSrc(booking);
    if (secCandidates.some((c) => legsOverlap(bookingLeg, toLegSrc(c)))) secondary = null;
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          vehicleId,
          primaryDriverId: driverId,
          ...(secondary ? { secondaryDriverId: secondary } : {}),
          status: "ASSIGNED",
          driverScheduleStatus: "CONFIRMED",
          decidedAt: new Date(),
          // Placing it by hand IS the resolution — the reason it could not be
          // placed, or was frozen for review, stops being true here. Without
          // this the trip returns to the day's overflow bar the moment the page
          // refreshes, with no way left to dismiss it but unassigning again.
          overflowReason: null,
        },
      });
      await tx.driver.update({ where: { id: driverId }, data: { lastAssignedAt: booking.startAt } });
      if (secondary) await tx.driver.update({ where: { id: secondary }, data: { lastAssignedAt: booking.startAt } });
    });
  } catch (e) {
    // DB backstop: the no-double-book EXCLUDE caught an overlap the per-leg
    // pre-check above missed (a bug or a race). Degrade to the same friendly
    // result instead of a 500.
    if (isExclusionViolation(e)) return { ok: false, error: "vehicleBusy" };
    throw e;
  }

  revalidatePath("/admin/schedule");
  return { ok: true };
}

// Move (or remove) a long-haul trip's CO-DRIVER by dragging the violet ghost.
// Dropping it on another car's row makes THAT car's driver the new co-driver;
// dropping it off any row (empty vehicleId) removes the co-driver. The co-driver
// rides in the PRIMARY's car — this only changes who co-drives, never the
// dispatched vehicle. Same overlap + active-driver guards as a primary reassign.
export async function reassignSecondaryAction(formData: FormData): Promise<ReassignResult> {
  await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  const vehicleId = String(formData.get("vehicleId") ?? ""); // "" = remove co-driver
  if (!bookingId) return { ok: false, error: "invalidInput" };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, primaryDriverId: true, startAt: true, endAt: true,
      waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
      overflowReason: true,
    },
  });
  if (!booking) return { ok: false, error: "bookingNotFound" };

  // Drop off a row → remove the co-driver.
  if (!vehicleId) {
    await prisma.booking.update({ where: { id: bookingId }, data: { secondaryDriverId: null } });
    revalidatePath("/admin/schedule");
    return { ok: true };
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      assignedDriverId: true,
      assignedDriver: { select: { isActive: true, user: { select: { isActive: true } } } },
    },
  });
  if (
    !vehicle?.assignedDriverId ||
    !vehicle.assignedDriver?.isActive ||
    !vehicle.assignedDriver.user?.isActive
  ) {
    return { ok: false, error: "noAssignedDriver" };
  }
  const newSecondary = vehicle.assignedDriverId;
  // A driver can't co-drive their own (or anyone's) trip as both roles.
  if (newSecondary === booking.primaryDriverId) return { ok: false, error: "coDriverSamePrimary" };

  // No overlap — the new co-driver must be free across the trip window. Coarse SQL
  // window is a superset of leg-overlap; refine per-leg via trip-legs.ts (the single
  // source of truth) so a co-driver that fits a no-wait trip's freed middle is not
  // falsely blocked. Matches reassignVehicleAction's per-leg checks.
  const secCandidates = await prisma.booking.findMany({
    where: {
      id: { not: bookingId },
      status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
      OR: [{ primaryDriverId: newSecondary }, { secondaryDriverId: newSecondary }],
      startAt: { lt: booking.endAt },
      endAt: { gt: booking.startAt },
    },
    orderBy: { startAt: "asc" },
    select: {
      jobNumber: true, startAt: true, endAt: true,
      waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
    },
  });
  const bookingLeg = toLegSrc(booking);
  const conflicts = secCandidates
    .filter((c) => legsOverlap(bookingLeg, toLegSrc(c)))
    .slice(0, 3)
    .map((c) => ({ jobNumber: c.jobNumber, startAt: c.startAt, endAt: c.endAt }));
  if (conflicts.length > 0) return { ok: false, error: "vehicleBusy", conflicts };

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      // Filling the co-driver seat resolves NO_SECONDARY_DRIVER — the only
      // reason this action can be the answer to. Leave any other reason alone.
      data: {
        secondaryDriverId: newSecondary,
        ...(booking.overflowReason === "NO_SECONDARY_DRIVER" ? { overflowReason: null } : {}),
      },
    });
    await tx.driver.update({ where: { id: newSecondary }, data: { lastAssignedAt: booking.startAt } });
  });
  revalidatePath("/admin/schedule");
  return { ok: true };
}

// Drag an assigned block back up to the queue: clear the trip's car + driver(s)
// so it returns to the unassigned pool. Releases the drivers' claims and rolls
// their rotation stamps back (so a removed TJW doesn't keep a driver "stamped"
// as having done it — same recompute the cancellation path uses).
export async function unassignBookingAction(formData: FormData): Promise<ReassignResult> {
  await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return { ok: false, error: "invalidInput" };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { primaryDriverId: true, secondaryDriverId: true, jobType: true, status: true },
  });
  if (!booking) return { ok: false, error: "bookingNotFound" };
  // Nothing assigned → already in the queue.
  if (!booking.primaryDriverId) return { ok: true };

  const freedDrivers = [booking.primaryDriverId, booking.secondaryDriverId].filter(
    (id): id is string => !!id,
  );

  await prisma.$transaction(async (tx) => {
    await tx.bookingClaim.deleteMany({ where: { bookingId } });
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        vehicleId: null,
        primaryDriverId: null,
        secondaryDriverId: null,
        status: "APPROVED",
        driverScheduleStatus: "UNCLAIMED",
        decidedAt: null,
        overflowReason: null,
        escalatedToKhunTop: false,
      },
    });
    await logTransition({
      bookingId,
      actorUserId: (await requireRole("ADMIN")).user.id,
      fromStatus: booking.status,
      toStatus: "APPROVED",
      action: "UNASSIGNED",
      metadata: { freedDrivers },
      tx,
    });
  });

  // Recompute each freed driver's category stamp from their remaining trips
  // (this booking is now unassigned, so it's excluded).
  for (const driverId of freedDrivers) {
    await recomputeRotationStamp(driverId, booking.jobType);
  }

  revalidatePath("/admin/schedule");
  return { ok: true };
}

/**
 * Move a เวร job's hours.
 *
 * เวร work is campus errands run by the duty driver — the hour is negotiable in
 * a way a meeting pickup is not, so P'Top routinely needs to slide one to make
 * room. Every other trip's time is the requester's booking and is not the
 * dispatcher's to change; this action therefore refuses anything that is not
 * WERN rather than becoming a general-purpose time editor.
 *
 * The car keeps its existing occupancy rules: moving a เวร into another trip's
 * window is refused by the same per-leg overlap check a drag uses, and the DB
 * exclusion constraint is the backstop if two admins move at once.
 */
export async function setWernTimeAction(formData: FormData): Promise<ReassignResult> {
  const session = await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  const startRaw = String(formData.get("startAt") ?? "");
  const endRaw = String(formData.get("endAt") ?? "");
  if (!bookingId || !startRaw || !endRaw) return { ok: false, error: "invalidInput" };

  const startAt = new Date(startRaw);
  const endAt = new Date(endRaw);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { ok: false, error: "invalidInput" };
  }
  if (endAt <= startAt) return { ok: false, error: "endBeforeStart" };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, jobType: true, vehicleId: true, status: true, startAt: true, endAt: true },
  });
  if (!booking) return { ok: false, error: "bookingNotFound" };
  if (booking.jobType !== "WERN") return { ok: false, error: "onlyWernTimeEditable" };

  // Same car, new window: refuse if it would collide with anything else on it.
  if (booking.vehicleId) {
    const clashes = await prisma.booking.findMany({
      where: {
        id: { not: bookingId },
        vehicleId: booking.vehicleId,
        status: { in: COMMITTED_STATUSES },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { jobNumber: true, startAt: true, endAt: true },
    });
    if (clashes.length > 0) {
      return {
        ok: false,
        error: "vehicleBusy",
        conflicts: clashes.map((c) => ({ jobNumber: c.jobNumber, startAt: c.startAt, endAt: c.endAt })),
      };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: bookingId }, data: { startAt, endAt } });
      await logTransition({
        bookingId,
        actorUserId: session.user.id,
        fromStatus: booking.status,
        toStatus: booking.status,
        action: "WERN_TIME_CHANGED",
        metadata: {
          from: { startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString() },
          to: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
        },
        tx,
      });
    });
  } catch (err) {
    // The per-vehicle GiST constraint is the backstop against a concurrent move.
    if (isExclusionViolation(err)) return { ok: false, error: "vehicleBusy" };
    throw err;
  }

  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/driver/schedule");
  return { ok: true };
}
