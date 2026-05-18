"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { sendEmail } from "@/lib/email/client";
import { requesterDeniedEmail } from "@/lib/email/templates";
import type { ActionResult } from "@/lib/booking/actions";

// ---- Cancellation (plan §6 Phase 5 + §5.8) ----

const cancelSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().min(2, "Tell us why you're cancelling"),
});

export async function cancelBookingAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = cancelSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, reason } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };

  // Requester may cancel their own booking. Admins may cancel any.
  const isAdmin = session.user.roles.includes("ADMIN");
  if (booking.requesterId !== userId && !isAdmin) {
    return { ok: false, error: te("notYourBooking") };
  }
  if (booking.status === "COMPLETED" || booking.status === "CANCELLED") {
    return { ok: false, error: te("cannotCancelInStatus", { status: ts(booking.status) }) };
  }

  await prisma.$transaction(async (tx) => {
    await tx.cancellation.create({
      data: { bookingId, cancelledByUserId: userId, reason },
    });
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED", decidedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        bookingId,
        actorUserId: userId,
        fromStatus: booking.status,
        toStatus: "CANCELLED",
        action: "BOOKING_CANCELLED",
        metadata: { reason },
      },
    });
  });

  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  return { ok: true };
}

// ---- Post-trip evaluation (plan §5.9 + §6 Phase 5) ----

const evalSchema = z
  .object({
    tripId: z.string().min(1),
    rating: z.enum(["NOT_GOOD", "SLIGHTLY_NOT_GOOD", "GOOD", "VERY_GOOD"]),
    comment: z.string().max(2000).optional().or(z.literal("")).transform((v) => v || undefined),
  })
  .superRefine((val, ctx) => {
    if ((val.rating === "NOT_GOOD" || val.rating === "SLIGHTLY_NOT_GOOD") && !val.comment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comment"],
        message: "A comment is required for negative ratings.",
      });
    }
  });

export async function submitEvaluationAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;
  const te = await getTranslations("errors");

  const parsed = evalSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { tripId, rating, comment } = parsed.data;

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { booking: { select: { id: true, requesterId: true } } },
  });
  if (!trip) return { ok: false, error: te("tripNotFound") };
  if (trip.booking.requesterId !== userId) return { ok: false, error: te("notYourTrip") };
  const existing = await prisma.evaluation.findUnique({ where: { tripId } });
  if (existing) return { ok: false, error: te("alreadyEvaluated") };

  await prisma.evaluation.create({
    data: { tripId, rating, comment },
  });

  revalidatePath("/requester");
  revalidatePath(`/requester/${trip.booking.id}`);
  return { ok: true };
}

// ---- Admin: outsourcing capture (plan §6 Phase 5) ----

const outsourceSchema = z.object({
  bookingId: z.string().min(1),
  outsourceVendor: z.string().min(2),
  outsourceCost: z.coerce.number().nonnegative(),
  outsourceReference: z
    .string()
    .max(200)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || undefined),
  notify: z.coerce.boolean().optional().default(true),
});

export async function recordOutsourcingAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = outsourceSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, outsourceVendor, outsourceCost, outsourceReference, notify } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.status !== "APPROVED") {
    return { ok: false, error: te("cannotOutsourceInStatus", { status: ts(booking.status) }) };
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        outsourceVendor,
        outsourceCost,
        outsourceReference,
        needsOutsourcing: true,
        status: "ASSIGNED",
        decidedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        bookingId,
        actorUserId: adminId,
        fromStatus: "APPROVED",
        toStatus: "ASSIGNED",
        action: "BOOKING_OUTSOURCED",
        metadata: { outsourceVendor, outsourceCost, outsourceReference },
      },
    });
  });

  if (notify) {
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
      const body = `Your booking ${detailed.jobNumber} has been outsourced to ${outsourceVendor}.`;
      await sendEmail({
        to: detailed.requester.email,
        subject: `Booking ${detailed.jobNumber} outsourced`,
        text: body,
        html: `<p>${body}</p>`,
      });
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}
