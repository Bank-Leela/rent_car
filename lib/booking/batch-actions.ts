"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";
import { runBatchForDay, type BatchStats } from "@/lib/booking/batch-core";
import type { ActionResult } from "@/lib/booking/actions";

const runBatchSchema = z.object({
  date: z.string().min(8), // YYYY-MM-DD
});

/**
 * ADMIN-gated daily-batch trigger — the /admin/batch "Run" button. Thin wrapper
 * over the auth-free core `runBatchForDay`; the daily cron route calls that core
 * directly with a resolved admin as the audit actor. Both paths share identical
 * scheduling logic.
 */
export async function runBatchAction(formData: FormData): Promise<ActionResult & { stats?: BatchStats }> {
  const session = await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const parsed = runBatchSchema.safeParse({ date: formData.get("date") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  return runBatchForDay(parsed.data.date, session.user.id);
}

// ---- CR-07 Update 10: cancellation rollback ----
//
// When a booking is cancelled (or its assignment is undone), the driver's
// category-rotation stamp must be cleared back to the previous trip in
// that category. Called by extra-actions.cancelBookingAction.
export async function rollbackRotationStampsForBooking(bookingId: string): Promise<void> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      primaryDriverId: true,
      secondaryDriverId: true,
      jobType: true,
      startAt: true,
    },
  });
  if (!b) return;
  const targets = [b.primaryDriverId, b.secondaryDriverId].filter((id): id is string => !!id);
  for (const driverId of targets) {
    await recomputeRotationStamp(driverId, b.jobType);
  }
}

// ---- Resolve NEEDS_WERN_RECLAIM_DECISION overflow ----
//
// Khun Top picks one of two options:
//   RECLAIM_WERN — re-assign the duty driver to this trip; ops handles
//     the standing campus rounds by hand for the day.
//   OUTSOURCE    — keep the duty driver on WERN, mark the trip for
//     outsourcing. The OutsourceForm picks up from here.
const resolveSchema = z.object({
  bookingId: z.string().min(1),
  decision: z.enum(["RECLAIM_WERN", "OUTSOURCE"]),
});

export async function resolveReclaimAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;
  const te = await getTranslations("errors");

  const parsed = resolveSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, decision } = parsed.data;
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      overflowReason: null,
      escalatedToKhunTop: decision === "OUTSOURCE",
      needsOutsourcing: decision === "OUTSOURCE",
    },
  });
  await logTransition({
    bookingId,
    actorUserId: adminId,
    fromStatus: booking.status,
    toStatus: booking.status,
    action: "RECLAIM_DECISION",
    metadata: { decision },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/batch");
  return { ok: true };
}
