"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
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

async function canDriveBooking(userId: string, bookingId: string): Promise<boolean> {
  const [user, booking] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { driverProfile: true },
    }),
    prisma.booking.findUnique({
      where: { id: bookingId },
      select: { primaryDriverId: true, secondaryDriverId: true },
    }),
  ]);
  const driverId = user?.driverProfile?.id;
  if (!driverId || !booking) return false;
  return booking.primaryDriverId === driverId || booking.secondaryDriverId === driverId;
}

export async function startTripAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");
  const parsed = startSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, startMileage } = parsed.data;

  if (!(await canDriveBooking(userId, bookingId))) {
    return { ok: false, error: te("notAssignedToTrip") };
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.status !== "ASSIGNED") {
    return { ok: false, error: te("cannotStartInStatus", { status: ts(booking.status) }) };
  }

  const existingTrip = await prisma.trip.findUnique({ where: { bookingId } });
  if (existingTrip) {
    return { ok: false, error: te("tripAlreadyStarted") };
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
  const te = await getTranslations("errors");
  const parsed = endSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, endMileage, fuelCost, tollwayCost, usedExpressway, driverNotes } = parsed.data;

  if (!(await canDriveBooking(userId, bookingId))) {
    return { ok: false, error: te("notAssignedToTrip") };
  }

  const trip = await prisma.trip.findUnique({ where: { bookingId } });
  if (!trip) return { ok: false, error: te("tripStartFirst") };
  if (trip.endedAt) return { ok: false, error: te("tripAlreadyComplete") };
  if (endMileage < trip.startMileage) {
    return { ok: false, error: te("endMileageLow") };
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
