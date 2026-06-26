// Pure conflict-resolution helpers for the schedule board's auto-assign button.
//
// The board's one hard rule (docs/scheduling-algorithm.md §5) is no-overlap: no
// car may be double-booked, ever. When two PRIMARY trips overlap on the same car
// (the red ring), one must move. This module decides WHICH one (the "loser") so
// the action layer can re-match it to a free legal car. Pure — no I/O.
import type { JobType } from "@prisma/client";

// Keep the higher-priority trip on the car; move the lower. Order matches the
// batch solver's category priority (TJW → OT → WERN → NORMAL → SMUS).
const PRIORITY: Record<JobType, number> = {
  TJW: 4,
  OT: 3,
  WERN: 2,
  NORMAL: 1,
  SMUS: 0,
};

export type ConflictTrip = {
  id: string;
  vehicleId: string;
  startAt: Date;
  endAt: Date;
  jobType: JobType;
  /** createdAt — the same-priority tie-break (later-submitted moves). */
  submittedAt: Date;
};

// Half-open overlap: touching edges (a.end === b.start) do NOT overlap.
function overlaps(a: ConflictTrip, b: ConflictTrip): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/**
 * Which of two overlapping trips moves.
 *
 * WERN/duty is reserved all day (docs §1/§5) and may NEVER be auto-relocated, so
 * it is **pinned**: in any WERN-vs-other pair the *other* trip is the loser. A
 * conflict on the duty car is therefore resolved by moving the intruder off (the
 * duty car is freed), never by re-homing duty work — which would silently drop
 * duty coverage and bypass the NEEDS_WERN_RECLAIM_DECISION escalation (§6b).
 *
 * Otherwise: lower category priority moves first; same priority → the
 * later-submitted one; final tie → the larger id (stable, deterministic).
 */
export function pickConflictLoser(a: ConflictTrip, b: ConflictTrip): ConflictTrip {
  const aWern = a.jobType === "WERN";
  const bWern = b.jobType === "WERN";
  if (aWern !== bWern) return aWern ? b : a; // the non-WERN intruder moves

  const pa = PRIORITY[a.jobType] ?? 0;
  const pb = PRIORITY[b.jobType] ?? 0;
  if (pa !== pb) return pa < pb ? a : b;
  const ta = a.submittedAt.getTime();
  const tb = b.submittedAt.getTime();
  if (ta !== tb) return ta > tb ? a : b;
  return a.id > b.id ? a : b;
}

/**
 * The set of trip ids that should move. For every pair of trips ON THE SAME CAR
 * that overlap in time, the loser is added. Pass PRIMARY trips only (co-driver
 * ghosts ride in the primary's car and never conflict). Greedy single pass: a
 * trip overlapping several others is still added once; the caller re-checks on
 * the next run for any residual conflict.
 */
export function findConflictLosers(trips: ConflictTrip[]): Set<string> {
  const losers = new Set<string>();
  const byVehicle = new Map<string, ConflictTrip[]>();
  for (const t of trips) {
    const arr = byVehicle.get(t.vehicleId) ?? [];
    arr.push(t);
    byVehicle.set(t.vehicleId, arr);
  }
  for (const group of byVehicle.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (overlaps(group[i], group[j])) {
          losers.add(pickConflictLoser(group[i], group[j]).id);
        }
      }
    }
  }
  return losers;
}
