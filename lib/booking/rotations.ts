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
// Canonical same-day chaining rule shared by both assignment paths (the batch
// solver via canTake, and the single-booking matcher via canTakeTrip):
//   - 0 existing trips        → can take.
//   - 2 existing trips        → cannot (1/day cap + the single override).
//   - Overlap                 → cannot.
//   - Otherwise allowed only as a morning(+afternoon) chain: ONE of the two
//     trips must END strictly before noon, and there must be a 2-hour gap.
//     A long midday trip (ends ≥ 12:00) therefore blocks a second trip.
export function canChain(
  next: { startAt: Date; endAt: Date },
  existing: { startAt: Date; endAt: Date }[],
): boolean {
  if (existing.length === 0) return true;
  if (existing.length >= MAX_JOBS_PER_DAY) return false;

  const e = existing[0]!;
  const newStart = next.startAt.getTime();
  const newEnd = next.endAt.getTime();
  const exStart = e.startAt.getTime();
  const exEnd = e.endAt.getTime();

  // Overlap always blocks.
  if (newStart < exEnd && exStart < newEnd) return false;

  // "Morning" = ends strictly before noon (12:00). 12:01–12:59 is NOT morning.
  const endsBeforeNoon = (d: Date) => d.getHours() < MORNING_END_HOUR;

  // Existing is a morning trip, the new one comes ≥2h later.
  if (endsBeforeNoon(e.endAt) && exEnd + TWO_HOUR_BUFFER_MS <= newStart) return true;
  // Mirror: the new trip is the morning one, existing comes ≥2h later.
  if (endsBeforeNoon(next.endAt) && newEnd + TWO_HOUR_BUFFER_MS <= exStart) return true;
  return false;
}

export function canTake(next: { startAt: Date; endAt: Date }, existing: ScheduledTrip[]): boolean {
  return canChain(next, existing);
}

/** Comparator: older-or-null wins. Returns negative if `a` comes first. */
function olderFirst(a: Date | null, b: Date | null): number {
  const at = a ? a.getTime() : -Infinity;
  const bt = b ? b.getTime() : -Infinity;
  return at - bt;
}

/** Pick the driver whose `lastTjwAt` is oldest. Tie → general ledger. */
export function pickTjwRotation(eligible: DriverRotationState[]): string | null {
  return rankForRotation(eligible, (d) => d.lastTjwAt)[0] ?? null;
}

/** Pick the driver whose `lastOtAt` is oldest. Tie → general ledger. */
export function pickOtRotation(eligible: DriverRotationState[]): string | null {
  return rankForRotation(eligible, (d) => d.lastOtAt)[0] ?? null;
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
