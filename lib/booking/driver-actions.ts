"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import {
  claimBookingSchema,
  releaseClaimSchema,
  confirmScheduleSchema,
} from "@/lib/booking/schema";
import { TWO_DRIVER_DISTANCE_KM } from "@/lib/booking/rules";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";
import { sendEmail } from "@/lib/email/client";
import { adminNewBookingEmail } from "@/lib/email/templates";
import type { ActionResult } from "@/lib/booking/actions";

const declineSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().min(3, "Reason is required").max(1000),
});

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

  revalidatePath("/driver");
  revalidatePath(`/driver/${bookingId}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}

// ---- CR-02: driver self-scheduling ----

async function getDriverProfileId(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { driverProfile: { select: { id: true, isActive: true } } },
  });
  if (!u?.driverProfile?.isActive) return null;
  return u.driverProfile.id;
}

export async function claimBookingAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("DRIVER");
  const userId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = claimBookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, role } = parsed.data;

  const driverId = await getDriverProfileId(userId);
  if (!driverId) return { ok: false, error: te("notADriver") };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { claims: { where: { status: "ACTIVE" } } },
  });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.status !== "APPROVED") {
    return { ok: false, error: te("cannotClaimInStatus", { status: ts(booking.status) }) };
  }

  // First-claim-wins: if another driver already holds an ACTIVE claim for
  // this role, refuse. The same driver claiming the same role is a no-op.
  const existingForRole = booking.claims.find((c) => c.role === role);
  if (existingForRole && existingForRole.driverId !== driverId) {
    return { ok: false, error: te("claimRoleTaken") };
  }
  // A driver cannot hold both roles on one booking.
  const otherRole = booking.claims.find((c) => c.driverId === driverId && c.role !== role);
  if (otherRole) {
    return { ok: false, error: te("claimAlreadyHeld") };
  }

  await prisma.$transaction(async (tx) => {
    if (!existingForRole) {
      await tx.bookingClaim.create({
        data: { bookingId, driverId, role, status: "ACTIVE" },
      });
    }
    const data: { primaryDriverId?: string; secondaryDriverId?: string; driverScheduleStatus?: "CLAIMED" } = {};
    if (role === "PRIMARY") data.primaryDriverId = driverId;
    else data.secondaryDriverId = driverId;
    if (booking.driverScheduleStatus === "UNCLAIMED") data.driverScheduleStatus = "CLAIMED";
    await tx.booking.update({ where: { id: bookingId }, data });
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: booking.status,
      toStatus: booking.status,
      action: "DRIVER_CLAIMED",
      metadata: { driverId, role },
      tx,
    });
  });

  revalidatePath("/driver/board");
  revalidatePath(`/driver/${bookingId}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  return { ok: true };
}

export async function releaseClaimAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("DRIVER");
  const userId = session.user.id;
  const te = await getTranslations("errors");

  const parsed = releaseClaimSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId } = parsed.data;

  const driverId = await getDriverProfileId(userId);
  if (!driverId) return { ok: false, error: te("notADriver") };

  const claim = await prisma.bookingClaim.findFirst({
    where: { bookingId, driverId, status: "ACTIVE" },
  });
  if (!claim) return { ok: false, error: te("noActiveClaim") };

  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { claims: { where: { status: "ACTIVE" } } },
  });
  // Once the trip is confirmed, drivers can't quietly drop out — admin must
  // be aware so the trip doesn't dispatch with a missing seat.
  if (booking.driverScheduleStatus === "CONFIRMED") {
    return { ok: false, error: te("cannotReleaseAfterConfirm") };
  }

  await prisma.$transaction(async (tx) => {
    await tx.bookingClaim.update({
      where: { id: claim.id },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
    const remaining = booking.claims.filter((c) => c.id !== claim.id);
    const data: {
      primaryDriverId?: string | null;
      secondaryDriverId?: string | null;
      driverScheduleStatus?: "UNCLAIMED" | "CLAIMED";
    } = {};
    if (claim.role === "PRIMARY") data.primaryDriverId = null;
    else data.secondaryDriverId = null;
    data.driverScheduleStatus = remaining.length === 0 ? "UNCLAIMED" : "CLAIMED";
    await tx.booking.update({ where: { id: bookingId }, data });
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: booking.status,
      toStatus: booking.status,
      action: "DRIVER_RELEASED",
      metadata: { driverId, role: claim.role },
      tx,
    });
  });

  revalidatePath("/driver/board");
  revalidatePath(`/driver/${bookingId}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  return { ok: true };
}

export async function confirmScheduleAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("DRIVER");
  const userId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = confirmScheduleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId } = parsed.data;

  const driverId = await getDriverProfileId(userId);
  if (!driverId) return { ok: false, error: te("notADriver") };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { claims: { where: { status: "ACTIVE" } } },
  });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.status !== "APPROVED") {
    return { ok: false, error: te("cannotConfirmInStatus", { status: ts(booking.status) }) };
  }
  if (booking.driverScheduleStatus === "CONFIRMED") {
    return { ok: false, error: te("scheduleAlreadyConfirmed") };
  }
  // Only the primary driver may confirm; secondary can't ratify the trip.
  const primaryClaim = booking.claims.find((c) => c.role === "PRIMARY");
  if (!primaryClaim || primaryClaim.driverId !== driverId) {
    return { ok: false, error: te("onlyPrimaryCanConfirm") };
  }
  // CR-02: the two-driver rule for long trips now applies at the driver
  // side. Trips over the threshold can't confirm without a secondary claim.
  const needsSecondary =
    typeof booking.estimatedDistance === "number" &&
    booking.estimatedDistance > TWO_DRIVER_DISTANCE_KM;
  const hasSecondary = booking.claims.some((c) => c.role === "SECONDARY");
  if (needsSecondary && !hasSecondary) {
    return { ok: false, error: te("secondaryRequired") };
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { driverScheduleStatus: "CONFIRMED", status: "ASSIGNED" },
    });
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: "APPROVED",
      toStatus: "ASSIGNED",
      action: "SCHEDULE_CONFIRMED",
      metadata: { primaryDriverId: driverId },
      tx,
    });
  });

  revalidatePath("/driver/board");
  revalidatePath(`/driver/${bookingId}`);
  revalidatePath("/driver");
  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}

/**
 * Driver declines an ASSIGNED trip they can't do. Unlike releaseClaimAction
 * (the board self-scheduling path, which blocks after CONFIRMED), this is the
 * "I'm assigned but unavailable" escape: it sends the whole trip back to the
 * APPROVED queue for the admin to re-dispatch, records the reason on the audit
 * log, and emails admins. A driver can't silently no-show — admin is made aware.
 */
export async function declineAssignmentAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("DRIVER");
  const userId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = declineSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, reason } = parsed.data;

  if (!(await canDriveBooking(userId, bookingId))) {
    return { ok: false, error: te("notYourTrip") };
  }

  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { status: true, jobType: true, primaryDriverId: true, secondaryDriverId: true },
  });
  // Only a live assignment can be declined.
  if (booking.status !== "ASSIGNED") {
    return { ok: false, error: te("cannotDeclineInStatus", { status: ts(booking.status) }) };
  }

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
      actorUserId: userId,
      fromStatus: "ASSIGNED",
      toStatus: "APPROVED",
      action: "DRIVER_DECLINED",
      metadata: { reason, freedDrivers },
      tx,
    });
  });

  // Freed drivers' category stamps recompute from their remaining trips (this
  // one is gone now) — same rollback the cancel/unassign paths use.
  for (const driverId of freedDrivers) {
    await recomputeRotationStamp(driverId, booking.jobType);
  }

  // Notify admins the trip is back in the assignment queue (decline reason is on
  // the audit log). Failure here doesn't block the decline.
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
    const admins = await prisma.user.findMany({
      where: { roles: { some: { role: "ADMIN" } }, isActive: true },
      select: { email: true },
    });
    const to = admins.map((a) => a.email).filter((e): e is string => !!e);
    if (to.length > 0) await sendEmail({ to, ...adminNewBookingEmail(detailed) });
  } catch (err) {
    console.error("[decline] admin notify failed", err);
  }

  revalidatePath("/driver");
  revalidatePath("/driver/board");
  revalidatePath(`/driver/${bookingId}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  return { ok: true };
}
