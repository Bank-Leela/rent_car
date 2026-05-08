"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import type { ActionResult } from "@/lib/booking/actions";

const startSchema = z.object({
  bookingId: z.string().min(1),
  startMileage: z.coerce.number().int().min(0).max(10_000_000),
});

const endSchema = z.object({
  bookingId: z.string().min(1),
  endMileage: z.coerce.number().int().min(0).max(10_000_000),
  fuelCost: z.coerce
    .number()
    .nonnegative()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? undefined : Number(v))),
  tollwayCost: z.coerce
    .number()
    .nonnegative()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? undefined : Number(v))),
  usedExpressway: z.coerce.boolean().optional().default(false),
  driverNotes: z
    .string()
    .max(2000)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || undefined),
});

/**
 * A user may act on a booking if they are the assigned driver, or they hold
 * GARAGE_COORDINATOR role (the plan allows coordinators to enter mileage on a
 * driver's behalf).
 */
async function canDriveBooking(userId: string, bookingId: string): Promise<boolean> {
  const [user, booking] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { driverProfile: true, roles: true },
    }),
    prisma.booking.findUnique({
      where: { id: bookingId },
      select: { primaryDriverId: true, secondaryDriverId: true },
    }),
  ]);
  if (!user || !booking) return false;
  if (user.roles.some((r) => r.role === "GARAGE_COORDINATOR")) return true;
  const driverId = user.driverProfile?.id;
  if (!driverId) return false;
  return booking.primaryDriverId === driverId || booking.secondaryDriverId === driverId;
}

export async function startTripAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;
  const parsed = startSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { bookingId, startMileage } = parsed.data;

  if (!(await canDriveBooking(userId, bookingId))) {
    return { ok: false, error: "You are not assigned to this trip." };
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (booking.status !== "ASSIGNED") {
    return { ok: false, error: `Cannot start a trip in status ${booking.status}` };
  }

  const existingTrip = await prisma.trip.findUnique({ where: { bookingId } });
  if (existingTrip) {
    return { ok: false, error: "Trip is already started." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.trip.create({
      data: { bookingId, startMileage, startedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        bookingId,
        actorUserId: userId,
        fromStatus: "ASSIGNED",
        toStatus: "ASSIGNED",
        action: "TRIP_STARTED",
        metadata: { startMileage },
      },
    });
  });

  revalidatePath("/driver");
  revalidatePath(`/driver/${bookingId}`);
  return { ok: true };
}

export async function endTripAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;
  const parsed = endSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { bookingId, endMileage, fuelCost, tollwayCost, usedExpressway, driverNotes } = parsed.data;

  if (!(await canDriveBooking(userId, bookingId))) {
    return { ok: false, error: "You are not assigned to this trip." };
  }

  const trip = await prisma.trip.findUnique({ where: { bookingId } });
  if (!trip) return { ok: false, error: "Start the trip first." };
  if (trip.endedAt) return { ok: false, error: "Trip is already complete." };
  if (endMileage < trip.startMileage) {
    return { ok: false, error: "End mileage must be ≥ start mileage." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.trip.update({
      where: { bookingId },
      data: {
        endMileage,
        distanceKm: endMileage - trip.startMileage,
        fuelCost,
        tollwayCost,
        usedExpressway,
        driverNotes,
        endedAt: new Date(),
      },
    });
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        bookingId,
        actorUserId: userId,
        fromStatus: "ASSIGNED",
        toStatus: "COMPLETED",
        action: "TRIP_COMPLETED",
        metadata: { endMileage, distanceKm: endMileage - trip.startMileage },
      },
    });
  });

  revalidatePath("/driver");
  revalidatePath(`/driver/${bookingId}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}
