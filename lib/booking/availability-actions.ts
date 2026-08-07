"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { sendEmail } from "@/lib/email/client";
import { requesterDriverOffEmail } from "@/lib/email/templates";
import { applyLeaveDay, clearLeaveDay, dayMidnight, daysInRange } from "@/lib/booking/leave-core";
import type { ActionResult } from "@/lib/booking/actions";

const bookingDetailInclude = {
  requester: true,
  department: true,
  vehicle: true,
  primaryDriver: { include: { user: true } },
  secondaryDriver: { include: { user: true } },
} as const;

function revalidateLeave() {
  revalidatePath("/admin");
  revalidatePath("/admin/schedule");
  revalidatePath("/driver/schedule");
}

/**
 * Only trips nothing could take generate an email. A trip handed to the เวร
 * driver keeps its date, time and destination — nothing changed for the
 * requester, so telling them their driver went off sick is noise.
 */
async function notifyReleased(ids: string[]) {
  if (ids.length === 0) return;
  try {
    const details = await prisma.booking.findMany({
      where: { id: { in: ids } },
      include: bookingDetailInclude,
    });
    for (const d of details) {
      if (d.requester.email) {
        await sendEmail({ to: [d.requester.email], ...requesterDriverOffEmail(d) });
      }
      revalidatePath(`/admin/${d.id}`);
      revalidatePath(`/requester/${d.id}`);
    }
  } catch (err) {
    console.error("[driverOff] notify failed", err);
  }
}

/**
 * Mark a driver off for ONE day, or clear it. The per-day chips on the board
 * use this for a same-day sick call; a planned absence goes through
 * setDriverLeaveRangeAction below.
 */
export async function setDriverUnavailableAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const driverId = String(formData.get("driverId") ?? "");
  const date = dayMidnight(String(formData.get("date") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const off = String(formData.get("off") ?? "") === "true";
  if (!driverId || !date) return { ok: false, error: "invalidInput" };

  if (!off) {
    await clearLeaveDay(driverId, date);
    revalidateLeave();
    return { ok: true };
  }

  const outcome = await applyLeaveDay(driverId, date, session.user.id, reason);
  await notifyReleased(outcome.released);
  revalidateLeave();
  return { ok: true };
}

/**
 * Mark a driver off across a DATE RANGE, or clear one.
 *
 * Leave is planned in blocks — "the 12th to the 16th" — and recording that a day
 * at a time meant navigating to each day's board and clicking there. Each day in
 * the range is settled independently (its own เวร re-roster, its own hand-off),
 * because a five-day absence can collide with five different duty drivers and
 * five different sets of trips.
 */
export async function setDriverLeaveRangeAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const driverId = String(formData.get("driverId") ?? "");
  const from = dayMidnight(String(formData.get("from") ?? ""));
  const to = dayMidnight(String(formData.get("to") ?? "")) ?? from;
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const off = String(formData.get("off") ?? "true") === "true";
  if (!driverId || !from || !to) return { ok: false, error: "invalidInput" };
  if (to < from) return { ok: false, error: "leaveRangeInverted" };

  const days = daysInRange(from, to);
  if (days.length === 0) return { ok: false, error: "invalidInput" };

  if (!off) {
    for (const d of days) await clearLeaveDay(driverId, d);
    revalidateLeave();
    return { ok: true };
  }

  const released: string[] = [];
  let handedOff = 0;
  let rerostered = 0;
  for (const d of days) {
    const outcome = await applyLeaveDay(driverId, d, session.user.id, reason);
    released.push(...outcome.released);
    handedOff += outcome.handedOff.length;
    if (outcome.rerosteredTo) rerostered += 1;
  }

  await notifyReleased(released);
  revalidateLeave();
  return {
    ok: true,
    days: days.length,
    handedOff,
    released: released.length,
    rerostered,
  } as ActionResult & { days: number; handedOff: number; released: number; rerostered: number };
}
