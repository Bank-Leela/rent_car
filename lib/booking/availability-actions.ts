"use server";

import { revalidatePath } from "next/cache";
import { endOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";
import { sendEmail } from "@/lib/email/client";
import { requesterDriverOffEmail } from "@/lib/email/templates";
import type { ActionResult } from "@/lib/booking/actions";

const bookingDetailInclude = {
  requester: true,
  department: true,
  vehicle: true,
  primaryDriver: { include: { user: true } },
  secondaryDriver: { include: { user: true } },
} as const;

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
 *
 * When marking off, any of that driver's still-upcoming ASSIGNED trips that day
 * lose their dispatch (ลาป่วย → คืนสล็อต): the trip reverts to APPROVED with the
 * vehicle/drivers cleared, so P'Top re-dispatches it (e.g. onto the duty car).
 * Affected requesters are emailed; the freed drivers' rotation stamps recompute.
 */
export async function setDriverUnavailableAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;
  const driverId = String(formData.get("driverId") ?? "");
  const date = dayMidnight(String(formData.get("date") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const off = String(formData.get("off") ?? "") === "true";
  if (!driverId || !date) return { ok: false, error: "invalidInput" };

  if (!off) {
    await prisma.driverUnavailability.deleteMany({ where: { driverId, date } });
    revalidatePath("/admin/schedule");
    return { ok: true };
  }

  await prisma.driverUnavailability.upsert({
    where: { driverId_date: { driverId, date } },
    create: { driverId, date, reason },
    update: { reason },
  });

  // Release this driver's still-upcoming ASSIGNED trips on that day — a trip
  // already finished stays as-is.
  const now = new Date();
  const affected = await prisma.booking.findMany({
    where: {
      status: "ASSIGNED",
      startAt: { gte: date, lte: endOfDay(date) },
      endAt: { gte: now },
      OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
    },
    select: { id: true, jobType: true, primaryDriverId: true, secondaryDriverId: true },
  });

  const releasedIds: string[] = [];
  for (const b of affected) {
    const freed = [b.primaryDriverId, b.secondaryDriverId].filter((id): id is string => !!id);
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: b.id },
        data: {
          vehicleId: null,
          primaryDriverId: null,
          secondaryDriverId: null,
          status: "APPROVED",
          driverScheduleStatus: "UNCLAIMED",
          decidedAt: null,
        },
      });
      await logTransition({
        bookingId: b.id,
        actorUserId: adminId,
        fromStatus: "ASSIGNED",
        toStatus: "APPROVED",
        action: "DRIVER_OFF_RELEASE",
        metadata: { driverId, reason, freedDrivers: freed },
        tx,
      });
    });
    // Rotation stamps recompute from the drivers' remaining trips (ids captured
    // before the clear).
    for (const id of freed) await recomputeRotationStamp(id, b.jobType);
    releasedIds.push(b.id);
  }

  // Notify affected requesters. Best-effort; never blocks the mark-off.
  if (releasedIds.length > 0) {
    try {
      const details = await prisma.booking.findMany({
        where: { id: { in: releasedIds } },
        include: bookingDetailInclude,
      });
      for (const d of details) {
        if (d.requester.email) {
          await sendEmail({ to: [d.requester.email], ...requesterDriverOffEmail(d) });
        }
      }
    } catch (err) {
      console.error("[driverOff] notify failed", err);
    }
    revalidatePath("/admin");
    for (const id of releasedIds) {
      revalidatePath(`/admin/${id}`);
      revalidatePath(`/requester/${id}`);
    }
  }

  revalidatePath("/admin/schedule");
  return { ok: true };
}
