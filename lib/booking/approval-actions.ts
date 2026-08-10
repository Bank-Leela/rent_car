"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { format } from "date-fns";
import { prisma } from "@/lib/db";
import { runBatchForDay } from "@/lib/booking/batch-core";
import { requireRole, requireUser } from "@/lib/auth-helpers";
import { dayHasRoomFor } from "@/lib/booking/approval-capacity";
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

  // Is there a car for this trip at all? Asked here, at the decision point,
  // because the submit-time slot count is stale by now — see approval-capacity.
  const room = await dayHasRoomFor(booking);
  const dayFull = room.gated && !room.fits;

  // A full day with no outside-rental option is not something to approve: the
  // fleet cannot serve it, so refuse and let P'Top deny from the queue. The
  // booking stays PENDING_APPROVAL, which is the only status denyByApproverAction
  // accepts.
  if (dayFull && !booking.needsOutsourcing) {
    // `dayFull` rides along so the queue can reveal its Deny button — the fleet
    // being full is the one refusal the approver is expected to act on, not
    // just read.
    return {
      ok: false,
      field: "startAt",
      error: te("dayFullCannotApprove"),
      dayFull: true,
    } as ActionResult & { dayFull: true };
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
        // Approving no longer hands out a car. The booking waits at
        // AWAITING_DOCUMENT until the signed official form is back and an ADMIN
        // confirms it (approveDocumentAction), which is what runs จัด.
        //
        // Unless the fleet is full AND the requester accepted an outside rental:
        // then there is no internal car to wait for, so it goes straight to
        // OUTSOURCED and leaves the internal pipeline for the timeline board's
        // per-day outside-vehicle row. Staff may still deny it later if no
        // vendor can be found — which is exactly what the form's notice says.
        status: dayFull ? "OUTSOURCED" : "AWAITING_DOCUMENT",
        ...(dayFull ? { needsOutsourcing: true } : {}),
        decidedAt: new Date(),
        // One-way: replace the provisional end with the admin-set time.
        ...(confirmedEndAt ? { endAt: confirmedEndAt } : {}),
      },
    });
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: booking.status,
      toStatus: dayFull ? "OUTSOURCED" : "AWAITING_DOCUMENT",
      action: dayFull ? "BOOKING_APPROVED_OUTSOURCED_DAY_FULL" : "BOOKING_APPROVED",
      metadata: {
        ...(comment ? { comment } : {}),
        ...(dayFull ? { reason: "no legal car on the day; requester accepted an outside rental" } : {}),
      },
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

  // จัด does NOT run here any more. The booking is now AWAITING_DOCUMENT and
  // gets its car when the paperwork is confirmed — see approveDocumentAction.
  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/admin/schedule");
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}

/**
 * "เอกสารเรียบร้อย" — the signed official form is back, so the booking may now
 * be given a car.
 *
 * This is the step that used to be implicit in approving. Approval decides the
 * trip may happen; this decides the paperwork supporting it is complete, and
 * only then does จัด run. ADMIN only: the transport office holds the signed
 * form, so they are the ones who know it is done.
 */
export async function approveDocumentAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const userId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return { ok: false, error: te("invalidInput") };

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.status !== "AWAITING_DOCUMENT") {
    return { ok: false, error: te("cannotApproveInStatus", { status: ts(booking.status) }) };
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: bookingId }, data: { status: "APPROVED" } });
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: "AWAITING_DOCUMENT",
      toStatus: "APPROVED",
      action: "DOCUMENT_APPROVED",
      tx,
    });
  });

  // จัด, moved here from approval. Same solver the manual button and the nightly
  // sweep use; it only touches APPROVED bookings with no primary driver, so it is
  // idempotent and cannot disturb an assignment that already exists. Wrapped
  // because assigning is a consequence of confirming the document, and a
  // consequence must never be able to undo its cause: if the solver throws, the
  // booking stays APPROVED and simply shows up as unassigned on that day's board.
  try {
    await runBatchForDay(format(booking.startAt, "yyyy-MM-dd"), userId);
  } catch (err) {
    console.error("[document] auto-assign failed; booking stays unassigned", err);
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/admin/schedule");
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
    const bytes = Buffer.from(await file.arrayBuffer());
    // Validate the ACTUAL bytes, not the client-supplied MIME (which curl/devtools
    // can spoof). A mismatched/corrupt image stored here would later 500 the
    // official-form PDF, since pdf-lib throws on undecodable bytes.
    // Magic: PNG = 89 50 4E 47, JPEG = FF D8 FF.
    const isPng =
      bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!isPng && !isJpeg) return { ok: false, error: te("signatureBadFormat") };
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
