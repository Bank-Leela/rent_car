"use server";

import { revalidatePath } from "next/cache";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";

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

  // car=driver: only the day's duty (WERN) car may hold overlapping trips — the
  // on-call driver carries a full-day reservation plus any reclaimed trip. Every
  // other car must never be double-booked.
  const onCall = await prisma.onCallShift.findUnique({
    where: { date: startOfDay(booking.startAt) },
    select: { driverId: true },
  });
  const isDutyCar = !!onCall?.driverId && vehicle.assignedDriverId === onCall.driverId;

  // Block if the target car already has an overlapping booking at this time —
  // only when actually moving to a different car (re-dropping on the same car
  // must not collide with itself), and never for the duty car.
  if (vehicleId !== booking.vehicleId && !isDutyCar) {
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
