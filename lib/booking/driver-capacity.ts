// CR-06 Algorithm 2: driver capacity.
//
// Two responsibilities:
//   1. Build a (drivers × JobType) matrix for the admin UI so they can see
//      who is currently on which category today. The red cells in
//      supervisor's matrix correspond to busy=true here.
//   2. Filter the pool of candidates for a *new* booking using the actual
//      scheduling rule (CR-06):
//        - Default cap: 1 trip per driver per day.
//        - Override: a driver who only did a morning trip (endAt ≤ noon)
//          may also take an afternoon trip starting ≥ 2 h after the
//          morning trip ended. Symmetric: afternoon-then-morning of the
//          *next* day is fine because the existing trip set is same-day
//          only.
//        - Anything else (2+ existing trips, insufficient gap, overlap)
//          blocks the driver.
//
// Ranking (`rankCandidates`) is unchanged:
//   earnings ↑, trips this month ↑, lastAssignedAt ↑ (oldest/null first).

import type { JobType } from "@prisma/client";

export const JOB_TYPES = [
  "TJW",
  "OT",
  "WERN",
  "NORMAL",
] as const satisfies readonly JobType[];

export const MORNING_AFTERNOON_GAP_HOURS = 2;
// "Morning" here = the trip ends at or before noon (12:00). Anything past
// that is treated as a full-day commitment for the 1/day rule.
const MORNING_CUTOFF_HOUR = 12;

export interface DriverInput {
  driverId: string;
  joinedAt: Date;
  lastAssignedAt: Date | null;
}

export interface DriverBusyTrip {
  driverId: string;
  jobType: JobType;
}

export interface DriverMatrixCell {
  driverId: string;
  jobType: JobType;
  busy: boolean;
}

/** Builds rows × columns matrix where row = driver, column = JobType. */
export function buildDriverMatrix(
  drivers: DriverInput[],
  busyToday: DriverBusyTrip[],
): DriverMatrixCell[][] {
  const busy = new Set<string>();
  for (const t of busyToday) busy.add(`${t.driverId}::${t.jobType}`);
  return drivers.map((d) =>
    JOB_TYPES.map((jobType) => ({
      driverId: d.driverId,
      jobType,
      busy: busy.has(`${d.driverId}::${jobType}`),
    })),
  );
}

export interface TripWindow {
  startAt: Date;
  endAt: Date;
}

/**
 * Can `candidate` driver legally take the new trip given their existing
 * same-day trips? Implements the CR-06 1/day cap + 2 h morning-afternoon
 * override.
 */
export function canTakeTrip(newTrip: TripWindow, existing: TripWindow[]): boolean {
  if (existing.length === 0) return true;
  if (existing.length >= 2) return false;
  const e = existing[0]!;
  const gapMs = MORNING_AFTERNOON_GAP_HOURS * 60 * 60 * 1000;

  const newStart = newTrip.startAt.getTime();
  const newEnd = newTrip.endAt.getTime();
  const exStart = e.startAt.getTime();
  const exEnd = e.endAt.getTime();

  // Overlapping windows always block.
  if (newStart < exEnd && exStart < newEnd) return false;

  // Existing trip is morning (ends ≤ noon), new trip is afternoon with gap.
  if (
    e.endAt.getHours() <= MORNING_CUTOFF_HOUR &&
    exEnd + gapMs <= newStart
  ) {
    return true;
  }
  // Mirror: new trip is morning, existing trip is afternoon with gap.
  if (
    newTrip.endAt.getHours() <= MORNING_CUTOFF_HOUR &&
    newEnd + gapMs <= exStart
  ) {
    return true;
  }
  return false;
}

export interface DriverAvailabilityInput {
  driverId: string;
  existing: TripWindow[];
}

/**
 * Drivers whose schedule allows the new trip under CR-06's 1/day +
 * 2 h override rule. JobType is no longer used as a hard filter — the
 * rule is purely temporal. The matrix display still shows per-JobType
 * busyness as information.
 */
export function filterAvailable(
  newTrip: TripWindow,
  drivers: DriverAvailabilityInput[],
): string[] {
  return drivers.filter((d) => canTakeTrip(newTrip, d.existing)).map((d) => d.driverId);
}

export interface RankInput {
  driverId: string;
  earningsScore: number;
  tripsThisMonth: number;
  lastAssignedAt: Date | null;
}

/**
 * Stable ordering: earnings ↑, trips ↑, lastAssignedAt ↑ (oldest/null first).
 */
export function rankCandidates(rows: RankInput[]): string[] {
  return [...rows]
    .sort((a, b) => {
      if (a.earningsScore !== b.earningsScore) return a.earningsScore - b.earningsScore;
      if (a.tripsThisMonth !== b.tripsThisMonth) return a.tripsThisMonth - b.tripsThisMonth;
      const at = a.lastAssignedAt ? a.lastAssignedAt.getTime() : -Infinity;
      const bt = b.lastAssignedAt ? b.lastAssignedAt.getTime() : -Infinity;
      return at - bt;
    })
    .map((r) => r.driverId);
}
