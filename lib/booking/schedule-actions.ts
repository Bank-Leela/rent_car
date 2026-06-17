"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";

// car=driver: dropping a booking on a car assigns the car AND its assigned
// driver. Blocks only if the car is already booked at that time, or the car has
// no assigned driver. The board maps the error code to a message.
type ReassignResult = { ok: false; error: string } | { ok: true };

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

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { assignedDriverId: true },
  });
  if (!vehicle?.assignedDriverId) return { ok: false, error: "noAssignedDriver" };

  // No overlap, ever — on EVERY car, including the duty car. A manual override
  // (drag / assign-reco) may relax the 2h chaining gap (not checked here), but it
  // must never double-book a car. Skip only when re-dropping on the same car (a
  // booking can't collide with itself; the query already excludes its own id).
  if (vehicleId !== booking.vehicleId) {
    const conflict = await prisma.booking.findFirst({
      where: {
        id: { not: bookingId },
        vehicleId,
        status: { in: ["APPROVED", "ASSIGNED"] },
        startAt: { lt: booking.endAt },
        endAt: { gt: booking.startAt },
      },
      select: { id: true },
    });
    if (conflict) return { ok: false, error: "vehicleBusy" };
  }

  const driverId = vehicle.assignedDriverId;
  // Re-validate the recommended co-driver: it was picked as free at render time,
  // but could have been booked since. Drop it (place primary only) if it now has
  // an overlapping trip — never silently double-book the co-driver.
  let secondary = secondaryDriverIdIn && secondaryDriverIdIn !== driverId ? secondaryDriverIdIn : null;
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
