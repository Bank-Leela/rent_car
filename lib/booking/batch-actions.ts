"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { startOfDay, subDays } from "date-fns";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { solveDay, type SolverBookingInput, type TjwCommitment } from "@/lib/booking/batch-solver";
import { JOB_WEIGHT } from "@/lib/booking/classification";
import type { DriverRotationState } from "@/lib/booking/rotations";
import type { ActionResult } from "@/lib/booking/actions";
import type { JobType } from "@prisma/client";

const FAIRNESS_WINDOW_DAYS = 30;

const runBatchSchema = z.object({
  date: z.string().min(8), // YYYY-MM-DD
});

/**
 * CR-07: solve the whole day's APPROVED bookings in one batch and persist
 * the resulting assignments + overflow reasons. Bookings flip to ASSIGNED
 * on success; overflow rows keep status APPROVED but get an
 * `overflowReason` set so Khun Top can resolve them by hand.
 *
 * Provisional rotation stamping (Update 10 of the change log): we bump
 * `lastTjwAt` / `lastOtAt` / `lastDutyAt` here so a re-run on the same
 * day doesn't double-pick the same driver. The cancellation flow rolls
 * the stamp back; completion is the final signal.
 */
export async function runBatchAction(formData: FormData): Promise<ActionResult & { stats?: BatchStats }> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const parsed = runBatchSchema.safeParse({ date: formData.get("date") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const date = new Date(`${parsed.data.date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { ok: false, error: te("invalidInput") };
  const dayStart = startOfDay(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // --- Pending bookings for the day (APPROVED, no primary yet). ---
  const pending = await prisma.booking.findMany({
    where: {
      status: "APPROVED",
      primaryDriverId: null,
      startAt: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { createdAt: "asc" },
  });

  // --- Driver pool + rotation snapshots. ---
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    select: {
      id: true,
      lastTjwAt: true,
      lastOtAt: true,
      lastDutyAt: true,
      lastAssignedAt: true,
    },
  });
  if (drivers.length === 0) return { ok: false, error: te("noActiveDrivers") };

  const earnings = await loadWeightedEarnings(drivers.map((d) => d.id));
  const driverStates: DriverRotationState[] = drivers.map((d) => ({
    driverId: d.id,
    lastTjwAt: d.lastTjwAt,
    lastOtAt: d.lastOtAt,
    lastDutyAt: d.lastDutyAt,
    lastAssignedAt: d.lastAssignedAt,
    earningsScore: earnings.get(d.id) ?? 0,
  }));

  // --- Duty driver for the day (from OnCallShift). ---
  const onCall = await prisma.onCallShift.findUnique({ where: { date: dayStart } });
  const dutyDriverId = onCall?.driverId ?? null;

  // --- Active TJW commitments (multi-day TJW trips that span today). ---
  const tjwSpanning = await prisma.booking.findMany({
    where: {
      jobType: "TJW",
      status: { in: ["ASSIGNED", "COMPLETED"] },
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
    },
    select: { primaryDriverId: true, secondaryDriverId: true, startAt: true, endAt: true },
  });
  const commitments: TjwCommitment[] = [];
  for (const t of tjwSpanning) {
    if (t.primaryDriverId) commitments.push({ driverId: t.primaryDriverId, startAt: t.startAt, endAt: t.endAt });
    if (t.secondaryDriverId) commitments.push({ driverId: t.secondaryDriverId, startAt: t.startAt, endAt: t.endAt });
  }

  // --- Convert pending bookings into solver inputs. ---
  const solverBookings: SolverBookingInput[] = pending.map((b) => ({
    bookingId: b.id,
    jobType: b.jobType,
    startAt: b.startAt,
    endAt: b.endAt,
    estimatedDistance: b.estimatedDistance,
    outOfProvince: b.outOfProvince,
    submittedAt: b.createdAt,
  }));

  const result = solveDay({
    date,
    bookings: solverBookings,
    drivers: driverStates,
    dutyDriverId,
    activeTjwCommitments: commitments,
  });

  // --- Persist assignments + bump rotation timestamps + record overflow. ---
  await prisma.$transaction(async (tx) => {
    for (const a of result.assignments) {
      const booking = pending.find((p) => p.id === a.bookingId)!;
      await tx.booking.update({
        where: { id: a.bookingId },
        data: {
          primaryDriverId: a.primaryDriverId,
          secondaryDriverId: a.secondaryDriverId,
          status: "ASSIGNED",
          driverScheduleStatus: "CONFIRMED",
          decidedAt: new Date(),
          overflowReason: null,
          escalatedToKhunTop: false,
        },
      });

      // Provisional rotation stamping: same-day re-runs need stamps to
      // already-be-bumped so the same driver isn't double-picked.
      const stamp = booking.startAt;
      await stampPrimary(tx, a.primaryDriverId, a.jobType, stamp);
      if (a.secondaryDriverId) {
        await stampSecondary(tx, a.secondaryDriverId, a.jobType, stamp);
      }

      await tx.auditLog.create({
        data: {
          bookingId: a.bookingId,
          actorUserId: (await requireRole("ADMIN")).user.id,
          fromStatus: "APPROVED",
          toStatus: "ASSIGNED",
          action: "BATCH_MATCHED",
          metadata: {
            primaryDriverId: a.primaryDriverId,
            secondaryDriverId: a.secondaryDriverId,
            jobType: a.jobType,
          },
        },
      });
    }
    for (const o of result.overflows) {
      await tx.booking.update({
        where: { id: o.bookingId },
        data: { overflowReason: o.reason },
      });
    }
  });

  revalidatePath("/admin");
  revalidatePath("/admin/batch");
  revalidatePath("/driver/board");

  const stats: BatchStats = {
    pendingCount: pending.length,
    matchedCount: result.assignments.length,
    overflowByReason: tallyOverflows(result.overflows),
  };
  return { ok: true, stats };
}

export interface BatchStats {
  pendingCount: number;
  matchedCount: number;
  overflowByReason: Record<string, number>;
}

function tallyOverflows(overflows: { reason: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of overflows) out[o.reason] = (out[o.reason] ?? 0) + 1;
  return out;
}

// ---- helpers ----

async function loadWeightedEarnings(driverIds: string[]): Promise<Map<string, number>> {
  if (driverIds.length === 0) return new Map();
  const since = subDays(new Date(), FAIRNESS_WINDOW_DAYS);
  const rows = await prisma.booking.findMany({
    where: {
      startAt: { gte: since },
      status: { in: ["ASSIGNED", "COMPLETED"] },
      OR: [
        { primaryDriverId: { in: driverIds } },
        { secondaryDriverId: { in: driverIds } },
      ],
    },
    select: { primaryDriverId: true, secondaryDriverId: true, jobType: true },
  });
  const scores = new Map<string, number>(driverIds.map((id) => [id, 0]));
  for (const b of rows) {
    const weight = JOB_WEIGHT[b.jobType] ?? 0;
    if (b.primaryDriverId && scores.has(b.primaryDriverId)) {
      scores.set(b.primaryDriverId, scores.get(b.primaryDriverId)! + weight);
    }
    if (b.secondaryDriverId && scores.has(b.secondaryDriverId)) {
      scores.set(b.secondaryDriverId, scores.get(b.secondaryDriverId)! + weight);
    }
  }
  return scores;
}

async function stampPrimary(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  driverId: string,
  jobType: JobType,
  stamp: Date,
) {
  const data: { lastAssignedAt: Date; lastTjwAt?: Date; lastOtAt?: Date; lastDutyAt?: Date } = {
    lastAssignedAt: stamp,
  };
  if (jobType === "TJW") data.lastTjwAt = stamp;
  else if (jobType === "OT") data.lastOtAt = stamp;
  else if (jobType === "WERN") data.lastDutyAt = stamp;
  await tx.driver.update({ where: { id: driverId }, data });
}

async function stampSecondary(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  driverId: string,
  jobType: JobType,
  stamp: Date,
) {
  // Secondaries share the same category-rotation stamp so the next batch
  // sees them as recently-used.
  await stampPrimary(tx, driverId, jobType, stamp);
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

async function recomputeRotationStamp(driverId: string, jobType: JobType): Promise<void> {
  const field =
    jobType === "TJW" ? "lastTjwAt" :
    jobType === "OT" ? "lastOtAt" :
    jobType === "WERN" ? "lastDutyAt" : null;
  if (!field) return;
  // Find the most-recent prior trip of this category for the driver that
  // is still ASSIGNED or COMPLETED.
  const last = await prisma.booking.findFirst({
    where: {
      jobType,
      status: { in: ["ASSIGNED", "COMPLETED"] },
      OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
    },
    orderBy: { startAt: "desc" },
    select: { startAt: true },
  });
  await prisma.driver.update({
    where: { id: driverId },
    data: { [field]: last?.startAt ?? null } as Record<string, Date | null>,
  });
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
  await prisma.auditLog.create({
    data: {
      bookingId,
      actorUserId: adminId,
      fromStatus: booking.status,
      toStatus: booking.status,
      action: "RECLAIM_DECISION",
      metadata: { decision },
    },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/batch");
  return { ok: true };
}
