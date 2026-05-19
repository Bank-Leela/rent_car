"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { startOfDay, subDays } from "date-fns";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { TWO_DRIVER_DISTANCE_KM } from "@/lib/booking/rules";
import {
  TIER_WEIGHT,
  type JobTier,
  classifyTier,
  canTakeTrip,
  pickNextOnCallDriver,
  rankCandidates,
} from "@/lib/booking/auto-assign";
import type { ActionResult } from "@/lib/booking/actions";

const FAIRNESS_WINDOW_DAYS = 30;

const autoAssignSchema = z.object({ bookingId: z.string().min(1) });
const setOnCallSchema = z.object({
  date: z.string().min(8), // yyyy-MM-dd
  driverId: z.string().min(1).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

function tierWeightOrNull(t: JobTier | null): number {
  return t ? TIER_WEIGHT[t] : 0;
}

// Live computation: cumulative tier-weight earnings per driver over the
// fairness window. Counts ASSIGNED + COMPLETED trips where the driver was
// primary or secondary. Provincial = 2 pts, on-call = 1 pt, etc.
async function loadEarningsScores(driverIds: string[]): Promise<Map<string, number>> {
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
    select: {
      jobTier: true,
      province: true,
      primaryDriverId: true,
      secondaryDriverId: true,
    },
  });
  const scores = new Map<string, number>(driverIds.map((id) => [id, 0]));
  for (const b of rows) {
    const tier = classifyTier({ jobTier: b.jobTier, province: b.province });
    const w = tierWeightOrNull(tier);
    if (b.primaryDriverId && scores.has(b.primaryDriverId)) {
      scores.set(b.primaryDriverId, scores.get(b.primaryDriverId)! + w);
    }
    if (b.secondaryDriverId && scores.has(b.secondaryDriverId)) {
      // Secondary gets full credit too — same trip, same day off the pool.
      scores.set(b.secondaryDriverId, scores.get(b.secondaryDriverId)! + w);
    }
  }
  return scores;
}

async function loadTripsThisMonth(driverIds: string[]): Promise<Map<string, number>> {
  if (driverIds.length === 0) return new Map();
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const counts = new Map<string, number>(driverIds.map((id) => [id, 0]));
  const rows = await prisma.booking.findMany({
    where: {
      startAt: { gte: firstOfMonth },
      status: { in: ["ASSIGNED", "COMPLETED"] },
      OR: [
        { primaryDriverId: { in: driverIds } },
        { secondaryDriverId: { in: driverIds } },
      ],
    },
    select: { primaryDriverId: true, secondaryDriverId: true },
  });
  for (const b of rows) {
    if (b.primaryDriverId && counts.has(b.primaryDriverId)) {
      counts.set(b.primaryDriverId, counts.get(b.primaryDriverId)! + 1);
    }
    if (b.secondaryDriverId && counts.has(b.secondaryDriverId)) {
      counts.set(b.secondaryDriverId, counts.get(b.secondaryDriverId)! + 1);
    }
  }
  return counts;
}

async function loadDriverDayTrips(
  driverIds: string[],
  day: Date,
): Promise<Map<string, Array<{ startAt: Date; endAt: Date }>>> {
  const dayStart = startOfDay(day);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const out = new Map<string, Array<{ startAt: Date; endAt: Date }>>(
    driverIds.map((id) => [id, []]),
  );
  if (driverIds.length === 0) return out;
  const rows = await prisma.booking.findMany({
    where: {
      startAt: { gte: dayStart, lt: dayEnd },
      status: { in: ["APPROVED", "ASSIGNED"] },
      OR: [
        { primaryDriverId: { in: driverIds } },
        { secondaryDriverId: { in: driverIds } },
      ],
    },
    select: { startAt: true, endAt: true, primaryDriverId: true, secondaryDriverId: true },
  });
  for (const b of rows) {
    if (b.primaryDriverId && out.has(b.primaryDriverId)) {
      out.get(b.primaryDriverId)!.push({ startAt: b.startAt, endAt: b.endAt });
    }
    if (b.secondaryDriverId && out.has(b.secondaryDriverId)) {
      out.get(b.secondaryDriverId)!.push({ startAt: b.startAt, endAt: b.endAt });
    }
  }
  return out;
}

export async function autoAssignBookingAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = autoAssignSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.status !== "APPROVED") {
    return { ok: false, error: te("cannotAutoAssignInStatus", { status: ts(booking.status) }) };
  }
  if (booking.primaryDriverId) {
    return { ok: false, error: te("alreadyHasPrimary") };
  }

  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (drivers.length === 0) return { ok: false, error: te("noActiveDrivers") };

  // Today's on-call driver is excluded from regular jobs.
  const tripDay = startOfDay(booking.startAt);
  const onCall = await prisma.onCallShift.findUnique({ where: { date: tripDay } });
  const onCallId = onCall?.driverId ?? null;

  const tier = classifyTier({ jobTier: booking.jobTier, province: booking.province });
  // On-call trips: the on-call driver takes them directly.
  if (tier === "ON_CALL") {
    if (!onCallId) return { ok: false, error: te("noOnCallSet") };
    await applyClaim(bookingId, onCallId, "PRIMARY", adminId, booking.status);
    revalidatePath("/admin");
    revalidatePath(`/admin/${bookingId}`);
    revalidatePath("/driver/board");
    return { ok: true };
  }

  const candidateIds = drivers
    .map((d) => d.id)
    .filter((id) => id !== onCallId);
  if (candidateIds.length === 0) return { ok: false, error: te("noEligibleDriver") };

  const [scores, monthCounts, dayTrips] = await Promise.all([
    loadEarningsScores(candidateIds),
    loadTripsThisMonth(candidateIds),
    loadDriverDayTrips(candidateIds, booking.startAt),
  ]);

  const eligible = candidateIds.filter((id) =>
    canTakeTrip(
      { startAt: booking.startAt, endAt: booking.endAt },
      dayTrips.get(id) ?? [],
    ),
  );
  if (eligible.length === 0) return { ok: false, error: te("noEligibleDriver") };

  const driverIndexById = new Map(drivers.map((d, i) => [d.id, i]));
  const ranked = rankCandidates(
    eligible.map((id) => ({
      driverId: id,
      earningsScore: scores.get(id) ?? 0,
      tripsThisMonth: monthCounts.get(id) ?? 0,
      tieBreaker: driverIndexById.get(id) ?? 0,
    })),
  );
  const primaryId = ranked[0];
  if (!primaryId) return { ok: false, error: te("noEligibleDriver") };

  await applyClaim(bookingId, primaryId, "PRIMARY", adminId, booking.status);

  // Long trip: pick a secondary from the remaining eligible drivers.
  const needsSecondary =
    typeof booking.estimatedDistance === "number" &&
    booking.estimatedDistance > TWO_DRIVER_DISTANCE_KM;
  if (needsSecondary) {
    const remaining = ranked.filter((id) => id !== primaryId);
    const secondaryId = remaining[0];
    if (secondaryId) {
      await applyClaim(bookingId, secondaryId, "SECONDARY", adminId, booking.status);
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/driver/board");
  return { ok: true };
}

async function applyClaim(
  bookingId: string,
  driverId: string,
  role: "PRIMARY" | "SECONDARY",
  actorUserId: string,
  fromStatus: "PENDING_APPROVAL" | "APPROVED" | "ASSIGNED" | "DENIED" | "CANCELLED" | "COMPLETED" | "DRAFT",
) {
  await prisma.$transaction(async (tx) => {
    await tx.bookingClaim.create({
      data: { bookingId, driverId, role, status: "ACTIVE" },
    });
    const data: { primaryDriverId?: string; secondaryDriverId?: string; driverScheduleStatus?: "CLAIMED" } = {};
    if (role === "PRIMARY") data.primaryDriverId = driverId;
    else data.secondaryDriverId = driverId;
    data.driverScheduleStatus = "CLAIMED";
    await tx.booking.update({ where: { id: bookingId }, data });
    await tx.auditLog.create({
      data: {
        bookingId,
        actorUserId,
        fromStatus,
        toStatus: fromStatus,
        action: "AUTO_ASSIGNED",
        metadata: { driverId, role },
      },
    });
  });
}

export async function setOnCallShiftAction(formData: FormData): Promise<ActionResult> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");
  const parsed = setOnCallSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { date, driverId } = parsed.data;
  const day = new Date(`${date}T00:00:00`);
  if (Number.isNaN(day.getTime())) return { ok: false, error: te("invalidInput") };

  let chosenDriverId = driverId;
  if (!chosenDriverId) {
    // Round-robin: pick the driver who hasn't been on-call most recently.
    const drivers = await prisma.driver.findMany({
      where: { isActive: true },
      select: {
        id: true,
        createdAt: true,
        onCallShifts: { orderBy: { date: "desc" }, take: 1, select: { date: true } },
      },
    });
    chosenDriverId = pickNextOnCallDriver(
      day,
      drivers.map((d) => ({
        driverId: d.id,
        lastOnCallAt: d.onCallShifts[0]?.date ?? null,
        joinedAt: d.createdAt,
      })),
    ) ?? undefined;
  }
  if (!chosenDriverId) return { ok: false, error: te("noActiveDrivers") };

  await prisma.onCallShift.upsert({
    where: { date: day },
    create: { date: day, driverId: chosenDriverId },
    update: { driverId: chosenDriverId },
  });

  revalidatePath("/admin");
  revalidatePath("/driver/board");
  return { ok: true };
}
