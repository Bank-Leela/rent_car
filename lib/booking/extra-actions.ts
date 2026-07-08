"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { sendEmail } from "@/lib/email/client";
import { requesterCancelledEmail, requesterOutsourcedEmail, adminBookingCancelledEmail } from "@/lib/email/templates";
import { writeOutsourceQuote } from "@/lib/storage";
import type { ActionResult } from "@/lib/booking/actions";
import { rollbackRotationStampsForBooking } from "@/lib/booking/batch-actions";

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
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: booking.status,
      toStatus: "CANCELLED",
      action: "BOOKING_CANCELLED",
      metadata: { reason },
      tx,
    });
  });

  // CR-07 Update 10: roll back the rotation stamp so the driver keeps
  // their slot for the next batch.
  await rollbackRotationStampsForBooking(bookingId);

  // Notify the other party. Admin-cancel → tell the requester. Requester
  // self-cancel of an already-approved/assigned booking → tell admins the slot
  // was freed (คืนสล็อตว่าง แจ้งแอดมิน). Failure never blocks the cancel.
  const wasActedOn = ["APPROVED", "ASSIGNED", "WAITLIST", "OUTSOURCED"].includes(booking.status);
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
    if (booking.requesterId !== userId) {
      if (detailed.requester.email) {
        await sendEmail({ to: [detailed.requester.email], ...requesterCancelledEmail(detailed, reason) });
      }
    } else if (wasActedOn) {
      const admins = await prisma.user.findMany({
        where: { roles: { some: { role: "ADMIN" } }, isActive: true },
        select: { email: true },
      });
      const to = admins.map((a) => a.email).filter((e): e is string => !!e);
      if (to.length > 0) await sendEmail({ to, ...adminBookingCancelledEmail(detailed, reason) });
    }
  } catch (err) {
    console.error("[cancel] notify failed", err);
  }

  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  return { ok: true };
}

// ---- Post-trip evaluation (plan §5.9 + §6 Phase 5) ----

const evalSchema = z.object({
  bookingId: z.string().min(1),
  // 1–5 stars (Google-review style). Comment is always optional.
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(2000).optional().or(z.literal("")).transform((v) => v || undefined),
});

export async function submitEvaluationAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = evalSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, rating, comment } = parsed.data;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: { include: { evaluation: true } } },
  });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.requesterId !== userId) return { ok: false, error: te("notYourBooking") };
  if (booking.status !== "COMPLETED") {
    return { ok: false, error: te("cannotEvaluateInStatus", { status: ts(booking.status) }) };
  }
  if (booking.trip?.evaluation) return { ok: false, error: te("alreadyEvaluated") };

  await prisma.$transaction(async (tx) => {
    // Trip is auto-created if missing (legacy completed bookings predate
    // the completeTripAction flow). Mileage defaults to 0 / estimatedDistance.
    let tripId = booking.trip?.id;
    if (!tripId) {
      const created = await tx.trip.create({
        data: {
          bookingId,
          startMileage: 0,
          distanceKm: booking.estimatedDistance ?? undefined,
          startedAt: booking.startAt,
          endedAt: booking.endAt,
        },
      });
      tripId = created.id;
    }
    await tx.evaluation.create({
      data: { tripId, rating, comment },
    });
  });

  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  revalidatePath("/admin/evaluations");
  return { ok: true };
}

// ---- Admin: mark trip completed ----
//
// Flips an ASSIGNED booking to COMPLETED and creates the Trip row that
// the post-trip evaluation form keys off. Mileage / fuel / tollway are
// optional shortcuts for ops; the requester only needs the booking to
// reach COMPLETED so the EvaluationForm appears on their detail page.

const completeTripSchema = z.object({
  bookingId: z.string().min(1),
  startMileage: z.coerce.number().int().nonnegative().optional().or(z.literal("")).transform((v) => (v === "" || v === undefined ? 0 : Number(v))),
  endMileage: z.coerce.number().int().nonnegative().optional().or(z.literal("")).transform((v) => (v === "" || v === undefined ? undefined : Number(v))),
  distanceKm: z.coerce.number().int().nonnegative().optional().or(z.literal("")).transform((v) => (v === "" || v === undefined ? undefined : Number(v))),
  driverNotes: z.string().max(2000).optional().or(z.literal("")).transform((v) => v || undefined),
});

export async function completeTripAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = completeTripSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, startMileage, endMileage, distanceKm, driverNotes } = parsed.data;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: true },
  });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.status !== "ASSIGNED") {
    return { ok: false, error: te("cannotCompleteInStatus", { status: ts(booking.status) }) };
  }
  if (booking.trip) return { ok: false, error: te("tripAlreadyExists") };

  const inferredDistance =
    distanceKm ??
    (endMileage !== undefined ? Math.max(0, endMileage - startMileage) : null) ??
    booking.estimatedDistance ??
    null;

  await prisma.$transaction(async (tx) => {
    await tx.trip.create({
      data: {
        bookingId,
        startMileage,
        endMileage,
        distanceKm: inferredDistance ?? undefined,
        driverNotes,
        startedAt: booking.startAt,
        endedAt: new Date(),
      },
    });
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await logTransition({
      bookingId,
      actorUserId: adminId,
      fromStatus: "ASSIGNED",
      toStatus: "COMPLETED",
      action: "BOOKING_COMPLETED",
      metadata: { startMileage, endMileage, distanceKm: inferredDistance },
      tx,
    });
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
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

  // Optional quote document (ใบเสนอราคา). Same limits as the memo attachment;
  // validated before the transaction so a bad file fails fast.
  const quote = formData.get("quote");
  let quoteRef: string | null = null;
  let quoteName: string | null = null;
  if (quote instanceof File && quote.size > 0) {
    if (quote.size > 10_000_000) return { ok: false, field: "quote", error: te("attachmentTooLarge") };
    const allowed: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };
    const ext = allowed[quote.type] ?? "";
    if (!ext) return { ok: false, field: "quote", error: te("attachmentBadFormat") };
    quoteRef = await writeOutsourceQuote(bookingId, ext, Buffer.from(await quote.arrayBuffer()));
    quoteName = quote.name;
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        outsourceVendor,
        outsourceCost,
        outsourceReference,
        ...(quoteRef ? { outsourceQuoteUrl: quoteRef, outsourceQuoteFilename: quoteName } : {}),
        needsOutsourcing: true,
        // OUTSOURCED is fully off-algorithm — clear the fleet car/drivers so the
        // trip no longer holds a slot or counts in fairness (unified with the
        // board's drag-to-external-row flow).
        status: "OUTSOURCED",
        vehicleId: null,
        primaryDriverId: null,
        secondaryDriverId: null,
        decidedAt: new Date(),
      },
    });
    await logTransition({
      bookingId,
      actorUserId: adminId,
      fromStatus: "APPROVED",
      toStatus: "OUTSOURCED",
      action: "BOOKING_OUTSOURCED",
      metadata: { outsourceVendor, outsourceCost, outsourceReference },
      tx,
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
      await sendEmail({ to: [detailed.requester.email], ...requesterOutsourcedEmail(detailed, outsourceVendor) });
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}

// ---- Secondary driver flag (replaces the old estimatedDistance > 400km
// auto-check) — admin decides case-by-case, typically for overnight
// out-of-province trips. Read by both the auto-matcher/batch solver and the
// driver-side schedule confirmation gate. ----

const needsSecondaryDriverSchema = z.object({
  bookingId: z.string().min(1),
  needsSecondaryDriver: z.coerce.boolean().optional().default(false),
});

export async function setNeedsSecondaryDriverAction(formData: FormData): Promise<ActionResult> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const parsed = needsSecondaryDriverSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, needsSecondaryDriver } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };

  await prisma.booking.update({ where: { id: bookingId }, data: { needsSecondaryDriver } });

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  return { ok: true };
}
