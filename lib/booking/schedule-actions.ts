"use server";

import { revalidatePath } from "next/cache";
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
  if (!bookingId || !vehicleId) return { ok: false, error: "invalidInput" };

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "bookingNotFound" };

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { assignedDriverId: true },
  });
  if (!vehicle?.assignedDriverId) return { ok: false, error: "noAssignedDriver" };

  // Block if the target car already has an overlapping booking at this time —
  // only when actually moving to a different car (re-dropping on the same car
  // must not collide with itself).
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
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        vehicleId,
        primaryDriverId: driverId,
        status: "ASSIGNED",
        driverScheduleStatus: "CONFIRMED",
        decidedAt: new Date(),
      },
    });
    await tx.driver.update({ where: { id: driverId }, data: { lastAssignedAt: booking.startAt } });
  });

  revalidatePath("/admin/schedule");
  return { ok: true };
}
