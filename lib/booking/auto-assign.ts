import { differenceInMinutes, isSameDay, startOfDay } from "date-fns";
import { BANGKOK_PROVINCE } from "@/lib/booking/rules";

// Public surface for the auto-assign algorithm. The action layer composes
// these pure functions together; tests exercise them in isolation.

export type JobTier = "INTERNATIONAL" | "SCHOOL" | "PROVINCIAL" | "ON_CALL";

// Bigger weight = better-paying tier. Drivers with the lowest cumulative
// weight are picked first so earnings even out over time.
export const TIER_WEIGHT: Record<JobTier, number> = {
  INTERNATIONAL: 4,
  SCHOOL: 3,
  PROVINCIAL: 2,
  ON_CALL: 1,
};

// ตจว ("out-of-Bangkok") covers everything that isn't กรุงเทพมหานคร. School
// and international trips must be flagged explicitly — we don't try to
// pattern-match destination strings.
export function classifyTier(input: {
  jobTier: JobTier | null | undefined;
  province: string;
}): JobTier {
  if (input.jobTier) return input.jobTier;
  return input.province === BANGKOK_PROVINCE ? "ON_CALL" : "PROVINCIAL";
}

// Driver-side rules: one regular trip per day, with a 2-hour buffer after
// the morning trip's scheduled end before the same driver can take an
// afternoon trip. "Morning" = scheduled to start before noon (local time).

export type DriverDayTrip = {
  startAt: Date;
  endAt: Date;
};

export const SAME_DAY_BUFFER_MINUTES = 120;
export const MORNING_CUTOFF_HOUR = 12;

function isMorning(d: Date): boolean {
  return d.getHours() < MORNING_CUTOFF_HOUR;
}

/**
 * Can this driver take a new trip with the given window, given the trips
 * they already hold on the same calendar day?
 */
export function canTakeTrip(
  candidate: { startAt: Date; endAt: Date },
  existingSameDay: DriverDayTrip[],
): boolean {
  if (existingSameDay.length === 0) return true;
  if (existingSameDay.length >= 2) return false;
  const prior = existingSameDay[0]!;
  // Already holds one trip. Eligible only if prior was a morning trip and
  // candidate is afternoon with the required gap after prior's scheduled
  // end (per Khun Top's rule: gap measured from scheduled end, not actual).
  const priorIsMorning = isMorning(prior.startAt);
  const candidateIsAfternoon = !isMorning(candidate.startAt);
  if (!priorIsMorning || !candidateIsAfternoon) return false;
  if (prior.endAt.getTime() >= candidate.startAt.getTime()) return false;
  return differenceInMinutes(candidate.startAt, prior.endAt) >= SAME_DAY_BUFFER_MINUTES;
}

// Pure ranking. Inputs:
//  - candidates: drivers eligible by role (excluding on-call driver, etc.)
//  - scores: cumulative tier-weight earnings per driver over the fairness
//    window (e.g. last 30 days)
//  - tripsThisMonth: tiebreaker
//  - claimSeenAt: stable tiebreaker on equal score (FCFS by id or createdAt)
export type RankInput = {
  driverId: string;
  earningsScore: number;
  tripsThisMonth: number;
  tieBreaker: number; // smaller first
};

export function rankCandidates(rows: RankInput[]): string[] {
  return [...rows]
    .sort((a, b) => {
      if (a.earningsScore !== b.earningsScore) return a.earningsScore - b.earningsScore;
      if (a.tripsThisMonth !== b.tripsThisMonth) return a.tripsThisMonth - b.tripsThisMonth;
      return a.tieBreaker - b.tieBreaker;
    })
    .map((r) => r.driverId);
}

// On-call rotation: round-robin through the active driver pool, skipping
// anyone who's been on-call within the last `cooldownDays`. Falls back to
// the least-recent driver if everyone has been on-call recently.
export type OnCallCandidate = {
  driverId: string;
  lastOnCallAt: Date | null;
  joinedAt: Date; // tiebreaker for "never been on-call"
};

export const ON_CALL_COOLDOWN_DAYS = 5;

export function pickNextOnCallDriver(
  today: Date,
  candidates: OnCallCandidate[],
): string | null {
  if (candidates.length === 0) return null;
  const cooldownMs = ON_CALL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const todayStart = startOfDay(today).getTime();
  const fresh = candidates.filter(
    (c) => !c.lastOnCallAt || todayStart - c.lastOnCallAt.getTime() >= cooldownMs,
  );
  const pool = fresh.length > 0 ? fresh : candidates;
  return [...pool]
    .sort((a, b) => {
      const aT = a.lastOnCallAt?.getTime() ?? 0;
      const bT = b.lastOnCallAt?.getTime() ?? 0;
      if (aT !== bT) return aT - bT;
      return a.joinedAt.getTime() - b.joinedAt.getTime();
    })
    .map((c) => c.driverId)[0]!;
}

// Helper for tests + UI: short label for a tier.
export function isSameLocalDay(a: Date, b: Date): boolean {
  return isSameDay(a, b);
}
