"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
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
 * Approver permission: a user may approve a booking when they are the head of
 * the booking's department, or when the head has delegated to them.
 */
async function canApprove(userId: string, departmentId: string): Promise<boolean> {
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { headUserId: true, head: { select: { delegatedToUserId: true } } },
  });
  if (!dept?.headUserId) return false;
  if (dept.headUserId === userId) return true;
  return dept.head?.delegatedToUserId === userId;
}

const approveSchema = z.object({
  bookingId: z.string().min(1),
  comment: z.string().max(1000).optional().or(z.literal("")).transform((v) => v || undefined),
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

  const parsed = approveSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { bookingId, comment } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (booking.status !== "PENDING_APPROVAL") {
    return { ok: false, error: `Cannot approve a booking in status ${booking.status}` };
  }
  if (!(await canApprove(userId, booking.departmentId))) {
    return { ok: false, error: "You are not authorized to approve this booking." };
  }

  const approver = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { signatureImageUrl: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.approval.create({
      data: {
        bookingId,
        approverId: userId,
        status: "APPROVED",
        signatureImageUrl: approver.signatureImageUrl,
        comment,
        decidedAt: new Date(),
      },
    });
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "APPROVED", decidedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        bookingId,
        actorUserId: userId,
        fromStatus: "PENDING_APPROVAL",
        toStatus: "APPROVED",
        action: "BOOKING_APPROVED",
        metadata: comment ? { comment } : undefined,
      },
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

  revalidatePath("/approver");
  revalidatePath(`/approver/${bookingId}`);
  revalidatePath("/admin");
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}

export async function denyByApproverAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;

  const parsed = denySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { bookingId, comment } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (booking.status !== "PENDING_APPROVAL") {
    return { ok: false, error: `Cannot deny a booking in status ${booking.status}` };
  }
  if (!(await canApprove(userId, booking.departmentId))) {
    return { ok: false, error: "You are not authorized to act on this booking." };
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
    await tx.auditLog.create({
      data: {
        bookingId,
        actorUserId: userId,
        fromStatus: "PENDING_APPROVAL",
        toStatus: "DENIED",
        action: "BOOKING_DENIED_BY_APPROVER",
        metadata: { comment },
      },
    });
  });

  const detailed = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: bookingDetailInclude,
  });
  if (detailed.requester.email) {
    await sendEmail({ to: detailed.requester.email, ...requesterDeniedEmail(detailed, comment) });
  }

  revalidatePath("/approver");
  revalidatePath(`/approver/${bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}

// ---- Profile: signature upload + delegation ----

export async function uploadSignatureAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;

  const file = formData.get("signature");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick an image file." };
  }
  if (file.size > 1_000_000) {
    return { ok: false, error: "Signature image must be under 1 MB." };
  }
  const isPng = file.type === "image/png";
  const isJpeg = file.type === "image/jpeg" || file.type === "image/jpg";
  if (!isPng && !isJpeg) {
    return { ok: false, error: "Use a PNG or JPEG image." };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const ref = await writeSignature(userId, bytes, isPng ? "png" : "jpg");
  await prisma.user.update({ where: { id: userId }, data: { signatureImageUrl: ref } });
  revalidatePath("/approver/profile");
  return { ok: true };
}

const delegateSchema = z.object({
  delegateEmail: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
});

export async function setDelegateAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;

  const parsed = delegateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid email" };
  }
  const { delegateEmail } = parsed.data;

  let delegatedToUserId: string | null = null;
  if (delegateEmail) {
    const target = await prisma.user.findUnique({ where: { email: delegateEmail } });
    if (!target) return { ok: false, error: `No user with email ${delegateEmail}` };
    if (target.id === userId) return { ok: false, error: "You cannot delegate to yourself." };
    delegatedToUserId = target.id;
  }
  await prisma.user.update({ where: { id: userId }, data: { delegatedToUserId } });
  revalidatePath("/approver/profile");
  return { ok: true };
}
