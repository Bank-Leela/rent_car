"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import type { ActionResult } from "@/lib/booking/actions";

// Parse a "yyyy-MM-dd" string to LOCAL midnight, matching startOfDay() in the
// pool loaders so the date equality lines up.
function dayMidnight(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Mark a driver off (sick / leave) for a day, or clear it. While off, the day's
 * pool loaders exclude them; fairness + rotation self-heal on return.
 */
export async function setDriverUnavailableAction(formData: FormData): Promise<ActionResult> {
  await requireRole("ADMIN");
  const driverId = String(formData.get("driverId") ?? "");
  const date = dayMidnight(String(formData.get("date") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const off = String(formData.get("off") ?? "") === "true";
  if (!driverId || !date) return { ok: false, error: "invalidInput" };

  if (off) {
    await prisma.driverUnavailability.upsert({
      where: { driverId_date: { driverId, date } },
      create: { driverId, date, reason },
      update: { reason },
    });
  } else {
    await prisma.driverUnavailability.deleteMany({ where: { driverId, date } });
  }
  revalidatePath("/admin/schedule");
  return { ok: true };
}
