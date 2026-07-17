"use server";

// CR-07 demo: simulate a day's worth of bookings, then run the batch.
//
// Generates a realistic mix of TJW / OT / WERN / NORMAL bookings tagged with
// `BatchDemo:` so the page populates with sample data and the algorithm has
// something to chew on. Idempotent — re-running wipes previous BatchDemo rows
// for the day before reseeding. Also ensures an OnCallShift exists for the day
// so the duty-driver dependent paths fire. Split out of batch-actions.ts: this
// is dev/demo scaffolding, wired only to the batch-run form.

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { startOfDay } from "date-fns";
import { z } from "zod";
import type { JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { runBatchAction, type BatchStats } from "@/lib/booking/batch-actions";
import type { ActionResult } from "@/lib/booking/actions";

const runBatchSchema = z.object({ date: z.string().min(8) });

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
  ajarn: string;
  ajarnEmail: string;
  pickup: string;
  male: number;
  female: number;
  emergency?: boolean;
  travelWithinChula?: boolean;
  notes?: string;
};

const DEMO_SLOTS: DemoSlot[] = [
  {
    purpose: `${BATCH_DEMO_TAG} TJW Chiang Mai medical conference (overnight)`,
    destination: "Chiang Mai University Hospital",
    province: "เชียงใหม่",
    startHour: 6, endHour: 18, endDayOffset: 1,
    jobType: "TJW", estimatedDistance: 700, outOfProvince: true,
    ajarn: "ศ.นพ. สมศักดิ์ ใจดี", ajarnEmail: "somsak.j@chula.ac.th",
    pickup: "อาคาร อปร ชั้น 1", male: 2, female: 1,    notes: "ต้องการรถตู้สำหรับอุปกรณ์",
  },
  {
    purpose: `${BATCH_DEMO_TAG} TJW Nakhon Pathom outreach (overnight)`,
    destination: "Nakhon Pathom field clinic",
    province: "นครปฐม",
    startHour: 7, endHour: 17, endDayOffset: 1,
    jobType: "TJW", estimatedDistance: 110, outOfProvince: true,
    ajarn: "รศ.พญ. วิภา รักเรียน", ajarnEmail: "wipa.r@chula.ac.th",
    pickup: "หน้าคณะแพทยศาสตร์", male: 1, female: 3,  },
  {
    purpose: `${BATCH_DEMO_TAG} OT early-bird airport run`,
    destination: "Suvarnabhumi Airport",
    province: "กรุงเทพมหานคร",
    startHour: 5, endHour: 9,
    jobType: "OT", estimatedDistance: 60, outOfProvince: false,
    ajarn: "อ.ดร. ธนกร พิทักษ์", ajarnEmail: "thanakorn.p@chula.ac.th",
    pickup: "ล็อบบี้ อาคารภูมิสิริ", male: 1, female: 0, emergency: true,
    notes: "เที่ยวบินเช้า ต้องตรงเวลา",
  },
  {
    purpose: `${BATCH_DEMO_TAG} OT evening seminar pickup`,
    destination: "Chamchuri Square",
    province: "กรุงเทพมหานคร",
    startHour: 17, endHour: 21,
    jobType: "OT", estimatedDistance: 25, outOfProvince: false,
    ajarn: "ผศ.นพ. กิตติ มานะ", ajarnEmail: "kitti.m@chula.ac.th",
    pickup: "จามจุรีสแควร์ ทางออก 2", male: 2, female: 2,  },
  {
    purpose: `${BATCH_DEMO_TAG} WERN duty round — campus shuttle`,
    destination: "Faculty of Medicine campus",
    province: "กรุงเทพมหานคร",
    startHour: 8, endHour: 12,
    jobType: "WERN", estimatedDistance: 15, outOfProvince: false,
    ajarn: "อ.พญ. ชนิดา ศรีสุข", ajarnEmail: "chanida.s@chula.ac.th",
    pickup: "อาคารแพทยพัฒน์", male: 0, female: 1, travelWithinChula: true,
  },
  {
    purpose: `${BATCH_DEMO_TAG} NORMAL morning lab supply`,
    destination: "Lab building 3",
    province: "กรุงเทพมหานคร",
    startHour: 9, endHour: 11,
    jobType: "NORMAL", estimatedDistance: 8, outOfProvince: false,
    ajarn: "อ.ดร. ปรีชา ตั้งใจ", ajarnEmail: "preecha.t@chula.ac.th",
    pickup: "อาคารวิจัย ชั้น G", male: 1, female: 1,
  },
  {
    purpose: `${BATCH_DEMO_TAG} NORMAL afternoon ajarn ride to King Chulalongkorn Hospital`,
    destination: "King Chulalongkorn Memorial Hospital",
    province: "กรุงเทพมหานคร",
    startHour: 13, endHour: 15,
    jobType: "NORMAL", estimatedDistance: 6, outOfProvince: false,
    ajarn: "ศ.พญ. อรทัย ดีงาม", ajarnEmail: "orathai.d@chula.ac.th",
    pickup: "โถงผู้ป่วยนอก", male: 0, female: 2,
  },
  {
    purpose: `${BATCH_DEMO_TAG} NORMAL document drop to Ministry`,
    destination: "Ministry of Public Health",
    province: "นนทบุรี",
    startHour: 14, endHour: 16,
    jobType: "NORMAL", estimatedDistance: 35, outOfProvince: true,
    ajarn: "อ.นพ. ภาคิน วงศ์ไทย", ajarnEmail: "pakin.w@chula.ac.th",
    pickup: "อาคารบริหาร", male: 1, female: 0,  },
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

  // Ensure OnCallShift for the day. Duty rotates by day (day-of-epoch modulo the
  // pool) so consecutive days get different on-call drivers — WERN switches daily.
  const dutyPool = await prisma.driver.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (dutyPool.length) {
    const dutyId = dutyPool[Math.floor(dayStart.getTime() / 86_400_000) % dutyPool.length]!.id;
    await prisma.onCallShift.upsert({
      where: { date: dayStart },
      create: { date: dayStart, driverId: dutyId },
      update: { driverId: dutyId },
    });
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
        passengerCount: Math.max(1, s.male + s.female),
        maleCount: s.male,
        femaleCount: s.female,
        passengerNotes: s.notes ?? null,
        pickupLocation: s.pickup,
        ajarnName: s.ajarn,
        ajarnPhone: "0812345678",
        ajarnEmail: s.ajarnEmail,
        isEmergency: s.emergency ?? false,
        emergencyReason: s.emergency ? "ผู้ป่วยฉุกเฉิน ต้องเดินทางด่วน" : null,
        travelWithinChula: s.travelWithinChula ?? false,
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

const DEMO_TAGS = ["BatchDemo:", "LongHaulDemo:", "FreeDayDemo:", "FiveAmDemo:"] as const;

/**
 * Full demo reset. Wipes EVERY *Demo: booking across ALL dates (not just the
 * selected day) — accumulated multi-day TJW trips otherwise leave every driver
 * "away" and re-saturate the pool so nothing auto-assigns — then clears the
 * drivers' rotation stamps back to a clean fairness baseline. FK cascade removes
 * each booking's child rows. The date in the form is ignored; this is a global
 * reset. Used by the "Clear demo data" button.
 */
export async function clearBatchDemoAction(formData: FormData): Promise<ActionResult & { clearedCount?: number }> {
  await requireRole("ADMIN");
  void formData;

  const del = await prisma.booking.deleteMany({
    where: { OR: DEMO_TAGS.map((tag) => ({ purpose: { startsWith: tag } })) },
  });
  await prisma.driver.updateMany({
    where: { isActive: true },
    data: { lastTjwAt: null, lastOtAt: null, lastDutyAt: null, lastAssignedAt: null },
  });

  revalidatePath("/admin/batch");
  revalidatePath("/admin/schedule");
  return { ok: true, clearedCount: del.count };
}
