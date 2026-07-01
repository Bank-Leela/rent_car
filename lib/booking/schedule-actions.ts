"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";
import { legsOverlap, type LegSource } from "@/lib/booking/trip-legs";
import { isExclusionViolation } from "@/lib/booking/db-errors";

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
        status: { in: ["APPROVED", "ASSIGNED"] },
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
    select: { id: true, primaryDriverId: true, startAt: true, endAt: true },
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

  // No overlap — the new co-driver must be free across the trip window.
  const conflicts = await prisma.booking.findMany({
    where: {
      id: { not: bookingId },
      status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
      OR: [{ primaryDriverId: newSecondary }, { secondaryDriverId: newSecondary }],
      startAt: { lt: booking.endAt },
      endAt: { gt: booking.startAt },
    },
    orderBy: { startAt: "asc" },
    take: 3,
    select: { jobNumber: true, startAt: true, endAt: true },
  });
  if (conflicts.length > 0) return { ok: false, error: "vehicleBusy", conflicts };

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: bookingId }, data: { secondaryDriverId: newSecondary } });
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
