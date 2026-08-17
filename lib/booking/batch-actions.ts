"use server";

import { revalidatePath } from "next/cache";
import { startOfDay } from "date-fns";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";
import { runBatchForDay, type BatchStats } from "@/lib/booking/batch-core";
import { reassignVehicleAction } from "@/lib/booking/schedule-actions";
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

  // RECLAIM_WERN has to actually move the duty driver onto the trip. It used to
  // write `overflowReason: null` and nothing else — no driver, no car — so the
  // >400 km trip simply lost the flag that was surfacing it: it dropped out of
  // the overflow card (keyed on `overflowReason: { not: null }`) into the plain
  // pending list, losing both the AssignRecoButton and the ReclaimDecisionForm,
  // i.e. every control that could still place it. The button's own label
  // ("ย้ายคนขับเวรมา"), this file's comment above, and
  // docs/scheduling-algorithm.md all say it assigns; only the code did not.
  if (decision === "RECLAIM_WERN") {
    const dayStart = startOfDay(booking.startAt);
    const shift = await prisma.onCallShift.findUnique({
      where: { date: dayStart },
      select: { driver: { select: { id: true, assignedVehicle: { select: { id: true } } } } },
    });
    const vehicleId = shift?.driver?.assignedVehicle?.id;
    if (!vehicleId) return { ok: false, error: te("noDutyDriverToReclaim") };

    // Reuse the dispatch path rather than writing the row here: it carries the
    // per-leg overlap checks on the car AND on the driver's other commitments,
    // the active-driver check, the co-driver re-validation, the occupancy
    // backstop, and the lastAssignedAt/rotation bookkeeping. It also clears
    // overflowReason itself — but only once the assignment has actually landed.
    const fd = new FormData();
    fd.set("bookingId", bookingId);
    fd.set("vehicleId", vehicleId);
    if (booking.secondaryDriverId) fd.set("secondaryDriverId", booking.secondaryDriverId);
    const res = await reassignVehicleAction(fd);
    if (!res.ok) return { ok: false, error: te("reclaimAssignFailed") };
  } else {
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        overflowReason: null,
        escalatedToKhunTop: true,
        needsOutsourcing: true,
      },
    });
  }
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
