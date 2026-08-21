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
import { canChain } from "./rotations";

export const JOB_TYPES = [
  "TJW",
  "OT",
  "WERN",
  "NORMAL",
] as const satisfies readonly JobType[];

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
  /** In-Chula campus errand. Carried so canChain can apply the §5c pairing
   *  exemption here too — without it the single matcher and the leave hand-off
   *  reach the opposite conclusion from the solver on identical inputs. */
  travelWithinChula?: boolean;
  startAt: Date;
  endAt: Date;
  // Drives the job-type-aware chaining rule (OT uncapped vs NORMAL morning/
  // afternoon). Omitted → treated as NORMAL.
  jobType?: JobType;
  // No-wait split fields (optional; absent ⇒ single interval). canChain frees a
  // no-wait trip's middle when measuring overlap/gap against it.
  waitAtDestination?: boolean;
  dropOffDone?: Date | null;
  pickupReturnTime?: string | null;
}

/**
 * Can `candidate` driver legally take the new trip given their existing
 * same-day trips? Implements the CR-06 1/day cap + 2 h morning-afternoon
 * override.
 */
export function canTakeTrip(newTrip: TripWindow, existing: TripWindow[]): boolean {
  // Unified with the batch solver: same 1/day + 2h-buffer chaining rule. This
  // replaces the old morning-cutoff variant that classed 12:01–12:59 as
  // "morning" (allowing a wrongful second trip) and diverged from the solver.
  return canChain(newTrip, existing);
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
 * Stable ordering: earnings ↑, trips ↑, lastAssignedAt ↑ (oldest/null first),
 * then driverId — the final tiebreak makes a full fairness tie deterministic
 * (matches pickFreeDriver / the rotation rankers), so which car wins a tie no
 * longer depends on the DB's row order.
 */
export function rankCandidates(rows: RankInput[]): string[] {
  return [...rows]
    .sort((a, b) => {
      if (a.earningsScore !== b.earningsScore) return a.earningsScore - b.earningsScore;
      if (a.tripsThisMonth !== b.tripsThisMonth) return a.tripsThisMonth - b.tripsThisMonth;
      const at = a.lastAssignedAt ? a.lastAssignedAt.getTime() : -Infinity;
      const bt = b.lastAssignedAt ? b.lastAssignedAt.getTime() : -Infinity;
      if (at !== bt) return at - bt;
      return a.driverId.localeCompare(b.driverId);
    })
    .map((r) => r.driverId);
}

export interface FreeDriverInput {
  driverId: string;
  earningsScore: number;
  lastAssignedAt: Date | null;
  /** The driver's other bookings that day. */
  trips: TripWindow[];
}

/**
 * The fairest driver who can legally take `trip` (no overlap + the 1/day-cap +
 * 2 h chain rule via canTakeTrip), excluding the on-call (duty) driver — or null
 * if none. Used by the schedule board's drag-to-car: assign a driver alongside
 * the vehicle, or block the drop. Same eligibility + fairness order as the matcher.
 */
export function pickFreeDriver(
  trip: TripWindow,
  drivers: FreeDriverInput[],
  dutyDriverId: string | null,
): string | null {
  const eligible = drivers
    .filter((d) => d.driverId !== dutyDriverId)
    .filter((d) => canTakeTrip(trip, d.trips))
    .sort(
      (a, b) =>
        a.earningsScore - b.earningsScore ||
        (a.lastAssignedAt?.getTime() ?? -Infinity) - (b.lastAssignedAt?.getTime() ?? -Infinity) ||
        a.driverId.localeCompare(b.driverId),
    );
  return eligible[0]?.driverId ?? null;
}
