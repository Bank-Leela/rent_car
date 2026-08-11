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
  // Deliberate override: approve even though no car can serve the day.
  //
  // It MUST be declared here. This is a plain z.object, which strips unknown
  // keys silently — a caller sending `force` without this line would parse
  // cleanly, be refused by the capacity gate anyway, and get an error message
  // that says nothing about the flag having been dropped.
  force: z.literal("1").optional(),
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
  const { bookingId, comment, endAt, force } = parsed.data;
  const forcing = force === "1";

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

  // A full day with no outside-rental option is not something to approve on the
  // ordinary path: the fleet cannot serve it, so refuse and let P'Top go free a
  // slot or deny. The booking stays PENDING_APPROVAL, which is the only status
  // denyByApproverAction accepts.
  //
  // `force` is the deliberate exception — P'Top approving anyway, knowing there
  // is no car. It is NOT a way to make the trip fit: nothing here invents
  // capacity, so the trip goes down the normal pipeline and surfaces on that
  // day's board as approved-with-no-car for a human to place by hand.
  if (dayFull && !booking.needsOutsourcing && !forcing) {
    // `dayFull` rides along so the queue can hide its approve button and offer
    // the board instead — the fleet being full is the one refusal the approver
    // is expected to act on, not just read.
    return {
      ok: false,
      field: "startAt",
      error: te("dayFullCannotApprove"),
      dayFull: true,
    } as ActionResult & { dayFull: true };
  }

  // Overriding the capacity rule has to be justified, and the check belongs
  // HERE rather than only in the component: approveSchema.comment is optional
  // (an ordinary approve note never needs a reason), so a client that skipped
  // the textarea — or called the action directly — would otherwise record an
  // override with no explanation at all.
  const overriding = forcing && dayFull && !booking.needsOutsourcing;
  if (overriding && (comment ?? "").trim().length < 3) {
    return { ok: false, field: "comment", error: te("forceApproveReasonRequired") };
  }

  // Two different things can be true when `dayFull` is: the requester accepted
  // an outside rental (the trip leaves the internal fleet → OUTSOURCED), or
  // P'Top overrode the gate (the trip STAYS internal and still needs a car).
  // Keeping them apart matters — collapsing them would file every forced
  // approval as an accepted outside rental, in both the status and the audit
  // trail.
  const outsourcing = dayFull && booking.needsOutsourcing;

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
        status: outsourcing ? "OUTSOURCED" : "AWAITING_DOCUMENT",
        ...(outsourcing ? { needsOutsourcing: true } : {}),
        decidedAt: new Date(),
        // One-way: replace the provisional end with the admin-set time.
        ...(confirmedEndAt ? { endAt: confirmedEndAt } : {}),
      },
    });
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: booking.status,
      toStatus: outsourcing ? "OUTSOURCED" : "AWAITING_DOCUMENT",
      // A distinct action per variant, not a metadata boolean — the booking
      // history renders `action` and never renders `metadata`, so an override
      // recorded only in metadata would be stored and still invisible to
      // everyone reading the page.
      action: outsourcing
        ? "BOOKING_APPROVED_OUTSOURCED_DAY_FULL"
        : overriding
          ? "BOOKING_APPROVED_FORCED_DAY_FULL"
          : "BOOKING_APPROVED",
      metadata: {
        ...(comment ? { comment } : {}),
        ...(outsourcing
          ? { reason: "no legal car on the day; requester accepted an outside rental" }
          : {}),
        ...(overriding
          ? { reason: "no legal car on the day; approved anyway by admin override" }
          : {}),
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

/**
 * Approve every remaining occurrence of a recurring booking in one go.
 *
 * A weekly trip booked for a term arrives as one card PER OCCURRENCE, each with
 * its own approve and deny. Ten identical decisions is not ten decisions — it is
 * one decision typed ten times, and the tenth gets less attention than the first.
 *
 * This makes it one press, WITHOUT weakening anything: each occurrence still
 * goes through approveBookingAction, so the capacity gate, the outsourcing
 * branch, the one-way end-time rule, the audit row and the emails all behave
 * exactly as they do individually. What comes back is a per-day account, because
 * the occurrences do NOT share a fate — the fleet can be free on the 23rd and
 * full on the 30th, and the approver has to be told which.
 *
 * `endTime` ("HH:mm") is for a one-way series: the occurrences share a route and
 * a duration, so one arrival time applies to every date, each on its own day.
 */
export type SeriesBlock = { id: string; date: string; reason: string };
export type SeriesApprovalResult =
  | { ok: true; approved: number; outsourced: number; blocked: SeriesBlock[] }
  | { ok: false; error?: string; approved?: number; outsourced?: number; blocked?: SeriesBlock[] };

export async function approveSeriesAction(formData: FormData): Promise<SeriesApprovalResult> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const parentId = String(formData.get("parentId") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  const endTime = String(formData.get("endTime") ?? "").trim(); // "HH:mm"
  if (!parentId) return { ok: false, error: te("invalidInput") };

  // The parent is itself an occurrence, so the series is the parent plus its
  // children. Only the ones still awaiting a decision are touched — re-running
  // after a partial approval must not disturb what already went through.
  const series = await prisma.booking.findMany({
    where: {
      status: { in: ["PENDING_APPROVAL", "WAITLIST"] },
      OR: [{ id: parentId }, { recurrenceParentId: parentId }],
    },
    orderBy: { startAt: "asc" },
    select: { id: true, startAt: true, returnTrip: true },
  });
  if (series.length === 0) return { ok: false, error: te("bookingNotFound") };

  let approved = 0;
  let outsourced = 0;
  const blocked: SeriesBlock[] = [];

  for (const b of series) {
    const fd = new FormData();
    fd.set("bookingId", b.id);
    if (comment) fd.set("comment", comment);
    // One-way: the same clock time, on this occurrence's own date.
    if (!b.returnTrip && endTime) {
      const [hh, mm] = endTime.split(":").map(Number);
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        const end = new Date(b.startAt);
        end.setHours(hh, mm, 0, 0);
        fd.set("endAt", format(end, "yyyy-MM-dd'T'HH:mm"));
      }
    }

    const res = await approveBookingAction(fd);
    if (res.ok) {
      const after = await prisma.booking.findUnique({ where: { id: b.id }, select: { status: true } });
      if (after?.status === "OUTSOURCED") outsourced += 1;
      else approved += 1;
    } else {
      blocked.push({
        id: b.id,
        date: format(b.startAt, "yyyy-MM-dd"),
        reason: res.error ?? te("invalidInput"),
      });
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/schedule");
  revalidatePath("/requester");
  // ok when ANY occurrence went through — a series where the fleet is full on
  // one day out of six is a partial success, not a failure, and the caller
  // reports the blocked days rather than throwing the lot away.
  return approved + outsourced > 0
    ? { ok: true, approved, outsourced, blocked }
    : { ok: false, approved, outsourced, blocked };
}

/** Deny every remaining occurrence of a recurring booking, one reason for all. */
export async function denySeriesAction(formData: FormData): Promise<SeriesApprovalResult> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const parentId = String(formData.get("parentId") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();
  if (!parentId) return { ok: false, error: te("invalidInput") };
  if (comment.length < 3) return { ok: false, error: te("invalidInput") };

  // denyByApproverAction accepts PENDING_APPROVAL only, so a WAITLIST occurrence
  // in the series is reported as blocked rather than silently skipped.
  const series = await prisma.booking.findMany({
    where: {
      status: { in: ["PENDING_APPROVAL", "WAITLIST"] },
      OR: [{ id: parentId }, { recurrenceParentId: parentId }],
    },
    orderBy: { startAt: "asc" },
    select: { id: true, startAt: true },
  });
  if (series.length === 0) return { ok: false, error: te("bookingNotFound") };

  let denied = 0;
  const blocked: SeriesBlock[] = [];
  for (const b of series) {
    const fd = new FormData();
    fd.set("bookingId", b.id);
    fd.set("comment", comment);
    const res = await denyByApproverAction(fd);
    if (res.ok) denied += 1;
    else blocked.push({ id: b.id, date: format(b.startAt, "yyyy-MM-dd"), reason: res.error ?? "" });
  }

  revalidatePath("/admin");
  revalidatePath("/requester");
  return denied > 0
    ? { ok: true, approved: denied, outsourced: 0, blocked }
    : { ok: false, approved: 0, outsourced: 0, blocked };
}

/**
 * Confirm the document for every remaining occurrence of a series.
 *
 * Same reasoning as approveSeriesAction: the paperwork for a recurring booking
 * is one form for the whole series, so confirming it occurrence by occurrence is
 * the same decision typed N times. Each still goes through
 * approveDocumentAction, so จัด runs per day exactly as it would individually —
 * and a day the fleet cannot serve is reported, not swallowed.
 */
export async function approveDocumentSeriesAction(formData: FormData): Promise<SeriesApprovalResult> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const parentId = String(formData.get("parentId") ?? "");
  if (!parentId) return { ok: false, error: te("invalidInput") };

  const series = await prisma.booking.findMany({
    where: {
      status: "AWAITING_DOCUMENT",
      OR: [{ id: parentId }, { recurrenceParentId: parentId }],
    },
    orderBy: { startAt: "asc" },
    select: { id: true, startAt: true },
  });
  if (series.length === 0) return { ok: false, error: te("bookingNotFound") };

  let approved = 0;
  const blocked: SeriesBlock[] = [];
  for (const b of series) {
    const fd = new FormData();
    fd.set("bookingId", b.id);
    const res = await approveDocumentAction(fd);
    if (res.ok) approved += 1;
    else blocked.push({ id: b.id, date: format(b.startAt, "yyyy-MM-dd"), reason: res.error ?? "" });
  }

  // Confirming the document runs จัด, but จัด is not obliged to succeed: a day
  // with no legal car leaves the booking APPROVED and driverless with an
  // overflowReason. Reporting only the action's own failures would call that a
  // clean success — the approver would be told 24 days went through while some
  // of them quietly have no car. Re-read and say which.
  const settled = await prisma.booking.findMany({
    where: { id: { in: series.map((b) => b.id) } },
    orderBy: { startAt: "asc" },
    select: { id: true, startAt: true, status: true, primaryDriverId: true, overflowReason: true },
  });
  const ts = await getTranslations("simulate");
  for (const b of settled) {
    if (b.status === "OUTSOURCED" || b.primaryDriverId) continue; // has a car, or left the fleet
    if (blocked.some((x) => x.id === b.id)) continue; // already reported as a hard failure
    blocked.push({
      id: b.id,
      date: format(b.startAt, "yyyy-MM-dd"),
      reason: b.overflowReason ? ts(`reason_${b.overflowReason}`) : te("noCarAssignedYet"),
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/schedule");
  return approved > 0
    ? { ok: true, approved, outsourced: 0, blocked }
    : { ok: false, approved: 0, outsourced: 0, blocked };
}
