"use server";

import { revalidatePath } from "next/cache";
import { addDays, parse, startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";
import { findConflictLosers } from "@/lib/booking/conflict-resolve";
import { recommendForBookings } from "@/lib/booking/placement-reco-data";

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
    const conflicts = await prisma.booking.findMany({
      where: {
        id: { not: bookingId },
        vehicleId,
        status: { in: ["APPROVED", "ASSIGNED"] },
        startAt: { lt: booking.endAt },
        endAt: { gt: booking.startAt },
      },
      orderBy: { startAt: "asc" },
      take: 3,
      select: { jobNumber: true, startAt: true, endAt: true },
    });
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
    const secBusy = await prisma.booking.findFirst({
      where: {
        id: { not: bookingId },
        status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
        OR: [{ primaryDriverId: secondary }, { secondaryDriverId: secondary }],
        startAt: { lt: booking.endAt },
        endAt: { gt: booking.startAt },
      },
      select: { id: true },
    });
    if (secBusy) secondary = null;
  }
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

type ConflictResolveResult =
  | { ok: false; error: string }
  | { ok: true; resolved: number; failures: string[] };

/**
 * Auto-resolve overlap conflicts on a day's schedule (docs §5: no car may be
 * double-booked). For every pair of PRIMARY trips that overlap on the same car,
 * the loser (lower category priority; tie → later-submitted — see
 * `conflict-resolve.ts`) is re-matched to a free legal car. Non-destructive: a
 * loser only moves when `recommendPlacement` finds a `fit` (free non-duty car
 * obeying canChain); a `reclaim`/`none` is left in place and reported. The duty
 * car is never auto-reclaimed for a conflict. Driven by the board's auto-assign
 * button, after it places the unassigned queue.
 */
export async function resolveScheduleConflictsAction(formData: FormData): Promise<ConflictResolveResult> {
  const session = await requireRole("ADMIN");
  const dateStr = String(formData.get("date") ?? "");
  const day = dateStr ? parse(dateStr, "yyyy-MM-dd", new Date()) : new Date();
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  // Assigned PRIMARY trips overlapping the viewed day (multi-day aware).
  const trips = await prisma.booking.findMany({
    where: {
      status: { in: ["APPROVED", "ASSIGNED"] },
      vehicleId: { not: null },
      primaryDriverId: { not: null },
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
    },
    select: {
      id: true,
      jobNumber: true,
      vehicleId: true,
      startAt: true,
      endAt: true,
      jobType: true,
      estimatedDistance: true,
      createdAt: true,
      status: true,
      secondaryDriverId: true,
    },
  });

  const loserIds = findConflictLosers(
    trips.map((t) => ({
      id: t.id,
      vehicleId: t.vehicleId!,
      startAt: t.startAt,
      endAt: t.endAt,
      jobType: t.jobType,
      submittedAt: t.createdAt,
    })),
  );
  if (loserIds.size === 0) return { ok: true, resolved: 0, failures: [] };

  const losers = trips.filter((t) => loserIds.has(t.id));
  let resolved = 0;
  const failures: string[] = [];

  for (const l of losers) {
    // Recompute the reco per loser so a prior move in this run is visible (its
    // new car shows as busy, so two losers never get sent to the same car).
    const recos = await recommendForBookings(
      dayStart,
      [{ id: l.id, startAt: l.startAt, endAt: l.endAt, estimatedDistance: l.estimatedDistance, jobType: l.jobType }],
      false,
    );
    const reco = recos.get(l.id);
    // Only a free non-duty car (`fit`) auto-resolves. `reclaim` (duty-only) and
    // `none` are left in place — overlap is never auto-relaxed onto the duty car.
    if (!reco || reco.kind !== "fit") {
      failures.push(`${l.jobNumber}: ${reco?.kind === "reclaim" ? "onlyDutyCarFree" : "noFreeCar"}`);
      continue;
    }

    const fd = new FormData();
    fd.set("bookingId", l.id);
    fd.set("vehicleId", reco.vehicleId);
    // Co-driver for a >400 km trip: prefer a fresh free one; else carry the
    // loser's existing co-driver through so reassignVehicleAction RE-VALIDATES it
    // (drops it if now busy) rather than silently preserving a stale one.
    const coDriver = reco.secondaryDriverId ?? l.secondaryDriverId;
    if (coDriver) fd.set("secondaryDriverId", coDriver);
    const res = await reassignVehicleAction(fd);
    if (res.ok) {
      resolved += 1;
      await logTransition({
        bookingId: l.id,
        actorUserId: session.user.id,
        fromStatus: l.status,
        toStatus: "ASSIGNED",
        action: "CONFLICT_RESOLVED",
        metadata: { movedToVehicle: reco.vehicleId },
      });
    } else {
      failures.push(`${l.jobNumber}: ${res.error}`);
    }
  }

  revalidatePath("/admin/schedule");
  return { ok: true, resolved, failures };
}
