"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import type { ActionResult } from "@/lib/booking/actions";

// Toggle the manual "submitted to LESS Paper" marker. The submission itself
// happens outside the app (admin downloads the filled form + uploads to LESS);
// this just records that he did, so the queue doesn't get double-submitted.
export async function toggleLessSubmittedAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const te = await getTranslations("errors");
  const bookingId = String(formData.get("bookingId") ?? "");
  const submitted = String(formData.get("submitted") ?? "") === "true";
  if (!bookingId) return { ok: false, error: te("invalidInput") };

  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };

  await prisma.booking.update({
    where: { id: bookingId },
    data: { lessSubmittedAt: submitted ? new Date() : null },
  });
  await logTransition({
    bookingId,
    actorUserId: session.user.id,
    fromStatus: booking.status,
    toStatus: booking.status,
    action: submitted ? "LESS_SUBMITTED" : "LESS_UNSUBMITTED",
  });

  revalidatePath(`/admin/${bookingId}`);
  return { ok: true };
}
