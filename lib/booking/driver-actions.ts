"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { isStationEmail } from "@/lib/auth/station";
import { logTransition } from "@/lib/booking/audit";
import { sendEmail } from "@/lib/email/client";
import { requesterCompletedEmail } from "@/lib/email/templates";
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
  fuelLiters: z.coerce
    .number()
    .nonnegative()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? undefined : Number(v))),
  fuelType: z
    .string()
    .max(40)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : undefined)),
  parkingCost: z.coerce
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
  if (!driverId || !booking || !user?.isActive) return false;
  return booking.primaryDriverId === driverId || booking.secondaryDriverId === driverId;
}

// True ONLY for the designated shared "station" kiosk (an allowlisted DRIVER
// account — see lib/auth/station.ts). Identified by a positive email allowlist,
// NOT by "no driver profile": an un-provisioned new driver or a multi-role
// ADMIN+DRIVER account is also profile-less and must NOT gain kiosk powers over
// other drivers' trips.
async function isSharedStation(session: { user: { id: string; roles: string[] } }): Promise<boolean> {
  if (!session.user.roles.includes("DRIVER")) return false;
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, isActive: true },
  });
  return !!u?.isActive && isStationEmail(u.email);
}

// Trip start/end is allowed for the assigned driver OR the shared station kiosk.
async function canRecordTrip(
  session: { user: { id: string; roles: string[] } },
  bookingId: string,
): Promise<boolean> {
  if (await canDriveBooking(session.user.id, bookingId)) return true;
  return isSharedStation(session);
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

  if (!(await canRecordTrip(session, bookingId))) {
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
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: "ASSIGNED",
      toStatus: "ASSIGNED",
      action: "TRIP_STARTED",
      metadata: { startMileage },
      tx,
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
  const ts = await getTranslations("status");
  const parsed = endSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, endMileage, fuelCost, fuelLiters, fuelType, parkingCost, tollwayCost, usedExpressway, driverNotes } = parsed.data;

  if (!(await canRecordTrip(session, bookingId))) {
    return { ok: false, error: te("notAssignedToTrip") };
  }

  // Re-assert the trip is still live before completing — a booking cancelled
  // after the trip started must not be resurrected to COMPLETED.
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.status !== "ASSIGNED") {
    return { ok: false, error: te("cannotEndInStatus", { status: ts(booking.status) }) };
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
        fuelLiters,
        fuelType,
        parkingCost,
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
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: "ASSIGNED",
      toStatus: "COMPLETED",
      action: "TRIP_COMPLETED",
      metadata: { endMileage, distanceKm: endMileage - trip.startMileage },
      tx,
    });
  });

  // Tell the requester their trip is done (the email's evaluate CTA doubles as
  // the evaluation reminder). Failure never blocks the completion itself.
  try {
    const detailed = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        requester: true,
        department: true,
        vehicle: true,
        primaryDriver: { include: { user: true } },
        secondaryDriver: { include: { user: true } },
      },
    });
    if (detailed.requester.email) {
      await sendEmail({ to: [detailed.requester.email], ...requesterCompletedEmail(detailed) });
    }
  } catch (err) {
    console.error("[endTrip] requester notify failed", err);
  }

  revalidatePath("/driver");
  revalidatePath(`/driver/${bookingId}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}
