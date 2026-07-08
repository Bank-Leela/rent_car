"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { isAdobeSignConfigured } from "@/lib/adobe-sign/config";
import { sendForSignature } from "@/lib/adobe-sign/client";
import { fillVehicleForm } from "@/lib/pdf/official-form";
import type { ActionResult } from "@/lib/booking/actions";

// Send a booking's filled official form to Adobe Acrobat Sign for the
// department head's signature. Manual, admin-only; inert unless configured.
export async function sendForSignatureAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const te = await getTranslations("errors");
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return { ok: false, error: te("invalidInput") };
  if (!isAdobeSignConfigured()) return { ok: false, error: "adobeNotConfigured" };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      requester: true,
      department: { include: { head: true } },
      vehicle: true,
      primaryDriver: { include: { user: true } },
      trip: true,
      approvals: { include: { approver: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (!["APPROVED", "ASSIGNED", "COMPLETED"].includes(booking.status)) {
    return { ok: false, error: "adobeBadStatus" };
  }
  if (booking.adobeAgreementId) return { ok: false, error: "adobeAlreadySent" };

  const head = booking.department?.head;
  const signerEmail = head?.email;
  if (!signerEmail) return { ok: false, error: "adobeNoSigner" };

  const decided = booking.approvals.find((a) => a.status === "APPROVED" || a.status === "DENIED");
  const pdf = await fillVehicleForm({
    ...booking,
    approverName: decided?.approver.name ?? null,
    denialReason: booking.denialReason ?? null,
  });

  let agreementId: string;
  try {
    agreementId = await sendForSignature({
      pdf,
      fileName: `${booking.jobNumber}.pdf`,
      agreementName: `ขออนุมัติใช้ยานพาหนะ ${booking.jobNumber}`,
      signer: { email: signerEmail, name: head?.name ?? undefined },
    });
  } catch (err) {
    console.error("[adobeSign] send failed", err);
    return { ok: false, error: "adobeSendFailed" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { adobeAgreementId: agreementId, adobeSignStatus: "OUT_FOR_SIGNATURE" },
    });
    await logTransition({
      bookingId,
      actorUserId: session.user.id,
      fromStatus: booking.status,
      toStatus: booking.status,
      action: "SENT_FOR_SIGNATURE",
      metadata: { agreementId, signer: signerEmail },
      tx,
    });
  });

  revalidatePath(`/admin/${bookingId}`);
  return { ok: true };
}
