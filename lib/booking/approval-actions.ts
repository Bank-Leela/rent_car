"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { sendEmail } from "@/lib/email/client";
import {
  requesterApprovedEmail,
  requesterDeniedEmail,
  adminNewBookingEmail,
} from "@/lib/email/templates";
import { writeSignature } from "@/lib/storage";
import { generateBookingPdf } from "@/lib/pdf/generate";
import type { ActionResult } from "@/lib/booking/actions";

/**
 * Approval permission. The former APPROVER role was merged into ADMIN, so any
 * ADMIN can approve. (Delegation was removed.)
 */
async function canApprove(userId: string): Promise<boolean> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: { select: { role: true } } },
  });
  if (!me) return false;
  return me.roles.some((r) => r.role === "ADMIN");
}

const approveSchema = z.object({
  bookingId: z.string().min(1),
  comment: z.string().max(1000).optional().or(z.literal("")).transform((v) => v || undefined),
  // Only sent for one-way ("ไม่เดินทางกลับ") bookings: the admin sets the real
  // end time here before approving. "yyyy-MM-ddTHH:mm" local string.
  endAt: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? new Date(v) : undefined)),
});

const denySchema = z.object({
  bookingId: z.string().min(1),
  comment: z.string().min(3, "Reason is required").max(1000),
});

const bookingDetailInclude = {
  requester: true,
  department: true,
  vehicle: true,
  primaryDriver: { include: { user: true } },
  secondaryDriver: { include: { user: true } },
} as const;

export async function approveBookingAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = approveSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, comment, endAt } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  // Approve normal pending bookings and over-capacity WAITLIST ones (P'Top
  // deciding the 11th+ case fits an available slot).
  if (booking.status !== "PENDING_APPROVAL" && booking.status !== "WAITLIST") {
    return { ok: false, error: te("cannotApproveInStatus", { status: ts(booking.status) }) };
  }
  if (!(await canApprove(userId))) {
    return { ok: false, error: te("notAuthorizedToApprove") };
  }

  // One-way ("ไม่เดินทางกลับ") bookings carry a provisional endAt; the admin must
  // set the real end time before approving. Round trips ignore any sent endAt.
  let confirmedEndAt: Date | undefined;
  if (!booking.returnTrip) {
    if (!endAt || Number.isNaN(endAt.getTime())) {
      return { ok: false, field: "endAt", error: te("endTimeRequiredOneWay") };
    }
    if (endAt.getTime() <= booking.startAt.getTime()) {
      return { ok: false, field: "endAt", error: te("endBeforeStart") };
    }
    confirmedEndAt = endAt;
  }

  await prisma.$transaction(async (tx) => {
    await tx.approval.create({
      data: {
        bookingId,
        approverId: userId,
        status: "APPROVED",
        comment,
        decidedAt: new Date(),
      },
    });
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "APPROVED",
        decidedAt: new Date(),
        // One-way: replace the provisional end with the admin-set time.
        ...(confirmedEndAt ? { endAt: confirmedEndAt } : {}),
      },
    });
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: booking.status,
      toStatus: "APPROVED",
      action: "BOOKING_APPROVED",
      metadata: comment ? { comment } : undefined,
      tx,
    });
  });

  // PDF + emails. Failures here don't block the approval.
  try {
    const pdfRef = await generateBookingPdf(bookingId);
    await prisma.booking.update({ where: { id: bookingId }, data: { pdfUrl: pdfRef } });
  } catch (err) {
    console.error("[pdf] generate failed", err);
  }

  const detailed = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: bookingDetailInclude,
  });

  if (detailed.requester.email) {
    await sendEmail({ to: detailed.requester.email, ...requesterApprovedEmail(detailed) });
  }
  // Notify admins now that the booking is ready for assignment.
  const admins = await prisma.user.findMany({
    where: { roles: { some: { role: "ADMIN" } }, isActive: true },
    select: { email: true },
  });
  const adminEmails = admins.map((a) => a.email).filter((e): e is string => !!e);
  if (adminEmails.length > 0) {
    await sendEmail({ to: adminEmails, ...adminNewBookingEmail(detailed) });
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}

export async function denyByApproverAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = denySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, comment } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.status !== "PENDING_APPROVAL") {
    return { ok: false, error: te("cannotDenyInStatus", { status: ts(booking.status) }) };
  }
  if (!(await canApprove(userId))) {
    return { ok: false, error: te("notAuthorizedToActOnBooking") };
  }

  await prisma.$transaction(async (tx) => {
    await tx.approval.create({
      data: {
        bookingId,
        approverId: userId,
        status: "DENIED",
        comment,
        decidedAt: new Date(),
      },
    });
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "DENIED", denialReason: comment, decidedAt: new Date() },
    });
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: "PENDING_APPROVAL",
      toStatus: "DENIED",
      action: "BOOKING_DENIED",
      metadata: { comment },
      tx,
    });
  });

  const detailed = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: bookingDetailInclude,
  });
  if (detailed.requester.email) {
    await sendEmail({ to: detailed.requester.email, ...requesterDeniedEmail(detailed, comment) });
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}

// ---- Account: register the requester's signature (image + name label) ----

export async function uploadSignatureAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;
  const te = await getTranslations("errors");

  const signatureName = String(formData.get("signatureName") ?? "").trim();
  if (!signatureName) return { ok: false, error: te("signatureNameRequired") };

  const file = formData.get("signature");
  const hasFile = file instanceof File && file.size > 0;

  // Name-only updates are allowed once a signature is on file; a first-time
  // registration must include the image.
  let ref: string | undefined;
  if (hasFile) {
    if (file.size > 1_000_000) return { ok: false, error: te("signatureTooLarge") };
    const isPng = file.type === "image/png";
    const isJpeg = file.type === "image/jpeg" || file.type === "image/jpg";
    if (!isPng && !isJpeg) return { ok: false, error: te("signatureBadFormat") };
    const bytes = Buffer.from(await file.arrayBuffer());
    ref = await writeSignature(userId, bytes, isPng ? "png" : "jpg");
  } else {
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { signatureImageUrl: true },
    });
    if (!me.signatureImageUrl) return { ok: false, error: te("signaturePickFile") };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { signatureName, ...(ref ? { signatureImageUrl: ref } : {}) },
  });
  revalidatePath("/account");
  return { ok: true };
}
