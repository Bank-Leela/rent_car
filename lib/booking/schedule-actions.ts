"use server";

import { revalidatePath } from "next/cache";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { loadWeightedEarnings } from "@/lib/booking/earnings";
import { pickFreeDriver, type FreeDriverInput } from "@/lib/booking/driver-capacity";

// A car-busy conflict still blocks; otherwise the drop always lands. `driverless`
// reports whether it landed without a driver (no one free at that time).
type ReassignResult = { ok: false; error: string } | { ok: true; driverless: boolean };

// Drag-and-drop on the schedule board: drop a booking onto a car row. Always
// assigns the vehicle, and attaches the fairest free driver if one exists.
// When no driver is free the booking still lands on the car — driverless, for
// the board to flag red and the admin to staff later / via จัด. Only a car
// already booked at that time blocks the drop.
export async function reassignVehicleAction(formData: FormData): Promise<ReassignResult> {
  await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  if (!bookingId || !vehicleId) return { ok: false, error: "invalidInput" };

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "bookingNotFound" };

  // Conflict check — only when actually moving to a DIFFERENT car (a driverless
  // rescue keeps the same car, so its own slot must not block it). Block if the
  // target car already has an overlapping booking at this time.
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

  const dayStart = startOfDay(booking.startAt);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [drivers, dayBookings, shift] = await Promise.all([
    prisma.driver.findMany({ where: { isActive: true }, select: { id: true, lastAssignedAt: true } }),
    prisma.booking.findMany({
      where: {
        id: { not: bookingId },
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
        status: { in: ["APPROVED", "ASSIGNED"] },
      },
      select: { primaryDriverId: true, secondaryDriverId: true, startAt: true, endAt: true },
    }),
    prisma.onCallShift.findUnique({ where: { date: dayStart } }),
  ]);
  const earnings = await loadWeightedEarnings(drivers.map((d) => d.id));

  const trips = new Map<string, { startAt: Date; endAt: Date }[]>();
  for (const b of dayBookings) {
    for (const id of [b.primaryDriverId, b.secondaryDriverId]) {
      if (!id) continue;
      const a = trips.get(id) ?? [];
      a.push({ startAt: b.startAt, endAt: b.endAt });
      trips.set(id, a);
    }
  }

  const candidates: FreeDriverInput[] = drivers.map((d) => ({
    driverId: d.id,
    earningsScore: earnings.get(d.id) ?? 0,
    lastAssignedAt: d.lastAssignedAt,
    trips: trips.get(d.id) ?? [],
  }));
  const driverId = pickFreeDriver(
    { startAt: booking.startAt, endAt: booking.endAt },
    candidates,
    shift?.driverId ?? null,
  );

  // No hard block — the car is assigned regardless. A driver is attached only
  // when one is free; otherwise the booking lands driverless (board flags red).
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        vehicleId,
        primaryDriverId: driverId,
        ...(driverId
          ? { status: "ASSIGNED", driverScheduleStatus: "CONFIRMED", decidedAt: new Date() }
          : {}),
      },
    });
    if (driverId) await tx.driver.update({ where: { id: driverId }, data: { lastAssignedAt: booking.startAt } });
  });

  revalidatePath("/admin/schedule");
  return { ok: true, driverless: !driverId };
}
