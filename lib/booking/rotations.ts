// CR-07 — rotation + eligibility primitives shared by the batch solver.
//
// Three category-specific rotations track the timestamp of each driver's
// last assignment in that category:
//
//   TJW    — `lastTjwAt`   (Driver.lastTjwAt)
//   WERN   — `lastDutyAt`  (Driver.lastDutyAt; also seeded from OnCallShift)
//   OT     — `lastOtAt`    (Driver.lastOtAt)
//
// Selection rule for every rotation is identical (Update 5 of the change
// log): among **eligible** drivers, pick the one with the **oldest**
// timestamp; `null` is treated as the oldest possible so brand-new drivers
// always come first. Ties break on the general fairness ledger
// (`earningsScore` ascending; then `lastAssignedAt` ascending).

import type { JobType } from "@prisma/client";

export const TWO_HOUR_BUFFER_MS = 2 * 60 * 60 * 1000;
export const MAX_JOBS_PER_DAY = 2;
export const MORNING_END_HOUR = 12;

export interface DriverRotationState {
  driverId: string;
  lastTjwAt: Date | null;
  lastOtAt: Date | null;
  lastDutyAt: Date | null;
  /** General-ledger fairness score (sum of weighted trips in window). */
  earningsScore: number;
  /** Last assignment of any kind; used only as a tertiary tie-break. */
  lastAssignedAt: Date | null;
}

export interface ScheduledTrip {
  /** Identifier so the solver can reference back to its source booking. */
  id: string;
  startAt: Date;
  endAt: Date;
  jobType: JobType;
}

/**
 * Can `candidate` legally take `next` given the trips they're already on
 * today? Implements the change log's 2-hour buffer + 2-job ceiling +
 * morning→afternoon chain rule.
 *
 *  - 0 trips today        → can take.
 *  - 1 trip today, gap ok → can take (chained morning + afternoon).
 *  - 2 trips already      → cannot take.
 *  - Any overlap          → cannot take.
 */
// Job-type-aware same-day chaining rule shared by both assignment paths (the
// batch solver via canTake, and the single-booking matcher via canTakeTrip).
// `jobType` defaults to NORMAL when omitted, so untyped callers get the
// day-job rules.
//
//   - 0 existing trips                       → can take.
//   - Overlap with any existing              → cannot.
//   - <2h gap to ANY existing trip           → cannot (universal). e.g. an OT
//     ending 06:00 lets an 08:00 job follow; ending 06:30 blocks it.
//   - NORMAL day-cap: at most 2 NORMALs, and they must be ONE morning
//     (ends ≤ 12:00) + ONE afternoon (starts ≥ 12:00). Two mornings, two
//     afternoons, or a midday job (straddles noon) + another are rejected.
//   - OT is exempt from the cap (extra hours on top) but still obeys the gap.
//     TJW/WERN are gated by the solver (away / duty) — here they only obey gap.
const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const NOON_MIN = MORNING_END_HOUR * 60;
const endsByNoon = (t: { endAt: Date }) => minuteOfDay(t.endAt) <= NOON_MIN;
const startsAfterNoon = (t: { startAt: Date }) => minuteOfDay(t.startAt) >= NOON_MIN;

type TimedJob = { startAt: Date; endAt: Date; jobType?: JobType };

export function canChain(next: TimedJob, existing: TimedJob[]): boolean {
  if (existing.length === 0) return true;

  // Universal: no overlap, and ≥2h between the new trip and EVERY existing trip.
  for (const e of existing) {
    if (next.startAt < e.endAt && e.startAt < next.endAt) return false; // overlap
    const gap2h =
      next.endAt.getTime() + TWO_HOUR_BUFFER_MS <= e.startAt.getTime() ||
      e.endAt.getTime() + TWO_HOUR_BUFFER_MS <= next.startAt.getTime();
    if (!gap2h) return false;
  }

  // Cap applies to NORMAL only — OT is extra hours on top.
  if ((next.jobType ?? "NORMAL") !== "NORMAL") return true;
  const normals = [next, ...existing.filter((e) => (e.jobType ?? "NORMAL") === "NORMAL")];
  if (normals.length > MAX_JOBS_PER_DAY) return false;
  if (normals.length === MAX_JOBS_PER_DAY) {
    // Exactly one morning + one afternoon.
    if (normals.filter(endsByNoon).length !== 1 || normals.filter(startsAfterNoon).length !== 1) {
      return false;
    }
  }
  return true;
}

export function canTake(next: TimedJob, existing: ScheduledTrip[]): boolean {
  return canChain(next, existing);
}

/** Comparator: older-or-null wins. Returns negative if `a` comes first. */
function olderFirst(a: Date | null, b: Date | null): number {
  const at = a ? a.getTime() : -Infinity;
  const bt = b ? b.getTime() : -Infinity;
  return at - bt;
}

/** Pick the driver whose `lastDutyAt` is oldest. Tie → general ledger. */
export function pickDutyRotation(eligible: DriverRotationState[]): string | null {
  return rankForRotation(eligible, (d) => d.lastDutyAt)[0] ?? null;
}

/**
 * Stable ordering for the NORMAL step's general-ledger rank: lowest
 * earnings first, then oldest `lastAssignedAt`, then `driverId` for
 * determinism.
 */
export function pickGeneralRank(eligible: DriverRotationState[]): string[] {
  return [...eligible]
    .sort((a, b) => {
      if (a.earningsScore !== b.earningsScore) return a.earningsScore - b.earningsScore;
      const t = olderFirst(a.lastAssignedAt, b.lastAssignedAt);
      if (t !== 0) return t;
      return a.driverId.localeCompare(b.driverId);
    })
    .map((d) => d.driverId);
}

/** Generic rotation ranker. Exported for the solver's secondary-pass logic. */
export function rankForRotation(
  eligible: DriverRotationState[],
  key: (d: DriverRotationState) => Date | null,
): string[] {
  return [...eligible]
    .sort((a, b) => {
      const t = olderFirst(key(a), key(b));
      if (t !== 0) return t;
      // General-ledger tie-break.
      if (a.earningsScore !== b.earningsScore) return a.earningsScore - b.earningsScore;
      const lt = olderFirst(a.lastAssignedAt, b.lastAssignedAt);
      if (lt !== 0) return lt;
      return a.driverId.localeCompare(b.driverId);
    })
    .map((d) => d.driverId);
}
