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
import { legsOverlap, minLegGapMinutes, type LegSource } from "./trip-legs";

// The universal 2h gap between any two of a driver's trips. Kept in minutes
// because that is the unit `minLegGapMinutes` returns — the previous
// `TWO_HOUR_BUFFER_MS` was never referenced, and the rule was enforced by a bare
// `120` below, so the documented constant and the actual rule could drift apart
// on the single most rule-critical line in the codebase.
export const MIN_GAP_MINUTES = 120;

/**
 * How far apart two in-Chula errands may start and still share one car.
 *
 * Lives beside MIN_GAP_MINUTES on purpose: they are the two time windows this
 * rule balances, and keeping them in one file is what stops them being
 * re-derived slightly differently in three modules — which is the failure this
 * subsystem's history is made of.
 */
export const IN_CHULA_PAIR_WINDOW_MINUTES = 10;
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
  /** In-Chula errand — may pair with another one (§5c). */
  travelWithinChula?: boolean;
  // No-wait split fields (optional; absent ⇒ single interval). Let canChain free
  // the middle of a no-wait trip when checking overlap/gap against this trip.
  waitAtDestination?: boolean;
  dropOffDone?: Date | null;
  pickupReturnTime?: string | null;
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
// Exported so the simulation harness checks the SAME predicates the solver
// applies. It re-derived them once and got the boundary wrong (`< 12:00`
// instead of `≤ 12:00`), which made every ordinary 08:00–12:00 trip count as
// neither morning nor afternoon — the rule-check reported 28 violations against
// a run the solver had placed correctly. A verifier that restates the rule is a
// second rule.
export const endsByNoon = (t: { endAt: Date }) => minuteOfDay(t.endAt) <= NOON_MIN;
export const startsAfterNoon = (t: { startAt: Date }) => minuteOfDay(t.startAt) >= NOON_MIN;

type TimedJob = {
  startAt: Date;
  endAt: Date;
  jobType?: JobType;
  /** In-Chula campus errand. Two of these starting within
   *  IN_CHULA_PAIR_WINDOW_MINUTES may share one car — see sharesCarWith. */
  travelWithinChula?: boolean;
  // No-wait split fields (optional; absent ⇒ single interval, back-compat).
  waitAtDestination?: boolean;
  dropOffDone?: Date | null;
  pickupReturnTime?: string | null;
};

// Adapt a TimedJob to the leg helper. Missing split data ⇒ one continuous leg.
const legSrc = (j: TimedJob): LegSource => ({
  startAt: j.startAt,
  endAt: j.endAt,
  waitAtDestination: j.waitAtDestination ?? true,
  dropOffDone: j.dropOffDone ?? null,
  pickupReturnTime: j.pickupReturnTime ?? null,
});

/**
 * The one deliberate exception to §5's no-double-book rule.
 *
 * Two IN-CHULA errands whose starts are within ten minutes of each other may
 * ride on the same car at the same time: campus is small, the trips are short,
 * and the office would rather send one car twice over than refuse the second
 * booking. Both halves of the condition matter — one in-Chula trip and one
 * normal trip never pair, however close their times, because the normal one may
 * be leaving the province.
 *
 * Measured start-to-start, deliberately: the office pairs errands that set off
 * together, and comparing end times would pair a ten-minute drop-off with an
 * all-afternoon booking that merely started nearby.
 */
export function sharesCarWith(a: TimedJob, b: TimedJob): boolean {
  if (!a.travelWithinChula || !b.travelWithinChula) return false;
  const minutes = Math.abs(a.startAt.getTime() - b.startAt.getTime()) / 60_000;
  return minutes <= IN_CHULA_PAIR_WINDOW_MINUTES;
}

export function canChain(next: TimedJob, existing: TimedJob[]): boolean {
  if (existing.length === 0) return true;

  // Universal: no overlap, and ≥2h between the new trip and EVERY existing trip.
  // Both are evaluated PER-LEG — a no-wait trip frees its middle, so another trip
  // may sit in the gap (lib/booking/trip-legs.ts is the single source of truth).
  // See docs/scheduling-algorithm.md §4–5.
  for (const e of existing) {
    // A paired in-Chula errand is exempt from BOTH checks — but only against
    // its partner. The loop continues, so this trip still owes the full gap and
    // the no-overlap rule to every OTHER trip on the day: pairing two campus
    // runs must never quietly buy a driver their way past the 2h gap before an
    // afternoon TJW.
    if (sharesCarWith(next, e)) continue;
    if (legsOverlap(legSrc(next), legSrc(e))) return false; // overlap on any leg
    if (minLegGapMinutes(legSrc(next), legSrc(e)) < MIN_GAP_MINUTES) return false;
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
