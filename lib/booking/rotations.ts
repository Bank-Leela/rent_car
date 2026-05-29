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
export function canTake(next: { startAt: Date; endAt: Date }, existing: ScheduledTrip[]): boolean {
  if (existing.length === 0) return true;
  if (existing.length >= MAX_JOBS_PER_DAY) return false;

  for (const e of existing) {
    const overlap = next.startAt < e.endAt && e.startAt < next.endAt;
    if (overlap) return false;
  }
  // After the overlap check, there's exactly one existing trip. Check the
  // 2-hour buffer in either direction.
  const e = existing[0]!;
  const gap = next.startAt >= e.endAt
    ? next.startAt.getTime() - e.endAt.getTime()
    : e.startAt.getTime() - next.endAt.getTime();
  return gap >= TWO_HOUR_BUFFER_MS;
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
