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

// ---- CR-07 demo: simulate a day's worth of bookings, then run the batch ----
//
// Generates a realistic mix of TJW / OT / WERN / NORMAL bookings tagged with
// `BatchDemo:` so the page populates with sample data and the algorithm has
// something to chew on. Idempotent — re-running wipes previous BatchDemo
// rows for the day before reseeding. Also ensures an OnCallShift exists for
// the day so the duty-driver dependent paths fire.

const BATCH_DEMO_TAG = "BatchDemo:";

type DemoSlot = {
  purpose: string;
  destination: string;
  province: string;
  startHour: number;
  endHour: number;
  endDayOffset?: number;
  jobType: JobType;
  estimatedDistance: number;
  outOfProvince: boolean;
};

const DEMO_SLOTS: DemoSlot[] = [
  {
    purpose: `${BATCH_DEMO_TAG} TJW Chiang Mai medical conference (overnight)`,
    destination: "Chiang Mai University Hospital",
    province: "เชียงใหม่",
    startHour: 6, endHour: 18, endDayOffset: 1,
    jobType: "TJW", estimatedDistance: 700, outOfProvince: true,
  },
  {
    purpose: `${BATCH_DEMO_TAG} TJW Nakhon Pathom outreach (overnight)`,
    destination: "Nakhon Pathom field clinic",
    province: "นครปฐม",
    startHour: 7, endHour: 17, endDayOffset: 1,
    jobType: "TJW", estimatedDistance: 110, outOfProvince: true,
  },
  {
    purpose: `${BATCH_DEMO_TAG} OT early-bird airport run`,
    destination: "Suvarnabhumi Airport",
    province: "กรุงเทพมหานคร",
    startHour: 5, endHour: 9,
    jobType: "OT", estimatedDistance: 60, outOfProvince: false,
  },
  {
    purpose: `${BATCH_DEMO_TAG} OT evening seminar pickup`,
    destination: "Chamchuri Square",
    province: "กรุงเทพมหานคร",
    startHour: 17, endHour: 21,
    jobType: "OT", estimatedDistance: 25, outOfProvince: false,
  },
  {
    purpose: `${BATCH_DEMO_TAG} WERN duty round — campus shuttle`,
    destination: "Faculty of Medicine campus",
    province: "กรุงเทพมหานคร",
    startHour: 8, endHour: 12,
    jobType: "WERN", estimatedDistance: 15, outOfProvince: false,
  },
  {
    purpose: `${BATCH_DEMO_TAG} NORMAL morning lab supply`,
    destination: "Lab building 3",
    province: "กรุงเทพมหานคร",
    startHour: 9, endHour: 11,
    jobType: "NORMAL", estimatedDistance: 8, outOfProvince: false,
  },
  {
    purpose: `${BATCH_DEMO_TAG} NORMAL afternoon ajarn ride to King Chulalongkorn Hospital`,
    destination: "King Chulalongkorn Memorial Hospital",
    province: "กรุงเทพมหานคร",
    startHour: 13, endHour: 15,
    jobType: "NORMAL", estimatedDistance: 6, outOfProvince: false,
  },
  {
    purpose: `${BATCH_DEMO_TAG} NORMAL document drop to Ministry`,
    destination: "Ministry of Public Health",
    province: "นนทบุรี",
    startHour: 14, endHour: 16,
    jobType: "NORMAL", estimatedDistance: 35, outOfProvince: true,
  },
];

function timeBucketFor(hour: number): "BEFORE_08" | "MORNING_08_12" | "AFTERNOON_12_16" | "AFTER_16" {
  if (hour < 8) return "BEFORE_08";
  if (hour < 12) return "MORNING_08_12";
  if (hour < 16) return "AFTERNOON_12_16";
  return "AFTER_16";
}

async function seedBatchDemoForDate(date: Date): Promise<number> {
  const dayStart = startOfDay(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Wipe previous demo rows for this day.
  const prior = await prisma.booking.findMany({
    where: {
      purpose: { startsWith: BATCH_DEMO_TAG },
      startAt: { gte: dayStart, lt: dayEnd },
    },
    select: { id: true },
  });
  if (prior.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: prior.map((p) => p.id) } } });
    await prisma.booking.deleteMany({ where: { id: { in: prior.map((p) => p.id) } } });
  }

  // Pick a requester with a department.
  const requester = await prisma.user.findFirst({
    where: { roles: { some: { role: "REQUESTER" } }, isActive: true, departmentId: { not: null } },
    select: { id: true, departmentId: true },
  });
  if (!requester || !requester.departmentId) {
    throw new Error("No active requester with a department. Seed the DB first.");
  }

  // Ensure OnCallShift for the day.
  const existingDuty = await prisma.onCallShift.findUnique({ where: { date: dayStart } });
  if (!existingDuty) {
    const firstDriver = await prisma.driver.findFirst({
      where: { isActive: true },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (firstDriver) {
      await prisma.onCallShift.create({ data: { date: dayStart, driverId: firstDriver.id } });
    }
  }

  // Find the next jobNumber sequence in the current month bucket.
  const ym = `VB-${dayStart.getFullYear()}${String(dayStart.getMonth() + 1).padStart(2, "0")}`;
  const peers = await prisma.booking.findMany({
    where: { jobNumber: { startsWith: ym } },
    select: { jobNumber: true },
  });
  let next = peers
    .map((p) => Number(p.jobNumber.split("-").pop() ?? 0))
    .reduce((mx, n) => (n > mx ? n : mx), 0) + 1;

  const at = (h: number) => {
    const d = new Date(dayStart);
    d.setHours(h, 0, 0, 0);
    return d;
  };

  for (const s of DEMO_SLOTS) {
    const startAt = at(s.startHour);
    const endAt = at(s.endHour);
    if (s.endDayOffset) endAt.setDate(endAt.getDate() + s.endDayOffset);
    await prisma.booking.create({
      data: {
        jobNumber: `${ym}-${next++}`,
        requesterId: requester.id,
        departmentId: requester.departmentId,
        purpose: s.purpose,
        destination: s.destination,
        province: s.province,
        startAt,
        endAt,
        passengerCount: 2,
        ajarnName: "อ.สมศักดิ์ ทดสอบ",
        ajarnPhone: "0812345678",
        status: "APPROVED",
        decidedAt: new Date(),
        jobType: s.jobType,
        timeBucket: timeBucketFor(s.startHour),
        outOfProvince: s.outOfProvince,
        estimatedDistance: s.estimatedDistance,
      },
    });
  }
  return DEMO_SLOTS.length;
}

/**
 * Simulate a day end-to-end: seed a mix of bookings into the target date,
 * then immediately run the batch solver against them. Returns combined
 * stats (seededCount + matched/overflows).
 */
export async function simulateAndRunBatchAction(
  formData: FormData,
): Promise<ActionResult & { stats?: BatchStats; seededCount?: number }> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const parsed = runBatchSchema.safeParse({ date: formData.get("date") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const date = new Date(`${parsed.data.date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { ok: false, error: te("invalidInput") };

  let seededCount = 0;
  try {
    seededCount = await seedBatchDemoForDate(date);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : te("invalidInput") };
  }

  // Hand off to the regular batch run.
  const runResult = await runBatchAction(formData);
  if (!runResult.ok) return runResult;
  return { ok: true, stats: runResult.stats, seededCount };
}

/**
 * Wipe all BatchDemo:* bookings for the given day (and the OnCallShift if
 * it points at the auto-seeded duty driver). Used by the "Clear demo data"
 * button so admins can reset between scenarios.
 */
export async function clearBatchDemoAction(formData: FormData): Promise<ActionResult & { clearedCount?: number }> {
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

  const prior = await prisma.booking.findMany({
    where: {
      purpose: { startsWith: BATCH_DEMO_TAG },
      startAt: { gte: dayStart, lt: dayEnd },
    },
    select: { id: true, primaryDriverId: true, secondaryDriverId: true, jobType: true },
  });

  await prisma.$transaction(async (tx) => {
    if (prior.length) {
      await tx.auditLog.deleteMany({ where: { bookingId: { in: prior.map((p) => p.id) } } });
      await tx.booking.deleteMany({ where: { id: { in: prior.map((p) => p.id) } } });
    }
  });

  // Recompute rotation stamps so cleared assignments don't keep stale lastTjwAt etc.
  const driverJobPairs = new Map<string, JobType>();
  for (const b of prior) {
    if (b.primaryDriverId) driverJobPairs.set(b.primaryDriverId, b.jobType);
    if (b.secondaryDriverId) driverJobPairs.set(b.secondaryDriverId, b.jobType);
  }
  for (const [driverId, jobType] of driverJobPairs) {
    await recomputeRotationStamp(driverId, jobType);
  }

  revalidatePath("/admin/batch");
  return { ok: true, clearedCount: prior.length };
}
