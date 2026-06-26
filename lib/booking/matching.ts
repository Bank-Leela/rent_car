// CR-06 Matching: combines Algorithm 1 (slot allocation) and Algorithm 2
// (driver capacity) and produces a (vehicle, primary, [secondary?])
// assignment. Pure orchestration; DB I/O lives in matching-actions.ts.

import type { JobType, TimeBucket } from "@prisma/client";
import {
  filterAvailable,
  rankCandidates,
  type DriverAvailabilityInput,
  type DriverMatrixCell,
  type RankInput,
  type TripWindow,
} from "./driver-capacity";
import { LONG_TRIP_KM } from "./classification";
export { LONG_TRIP_KM };

export type MatchError =
  | "NO_SLOT"
  | "NO_PRIMARY_DRIVER"
  | "NO_SECONDARY_DRIVER";

export interface MatchInput {
  jobType: JobType;
  timeBucket: TimeBucket;
  newTrip: TripWindow;
  estimatedDistance: number | null;
  /** car=driver: assignedDriverId -> vehicleId. The booking's vehicle is the
   *  chosen primary driver's car; there is no independent slot search. */
  driverCar: Map<string, string>;
  /** UI snapshot of current driver loads. Not used as a hard filter; see
   *  driverAvailability for the temporal rule. */
  driverMatrix: DriverMatrixCell[][];
  driverAvailability: DriverAvailabilityInput[];
  driverRankInputs: RankInput[];
  /** The day's on-call (WERN duty) driver, if any. Reserved for the whole
   *  day and never auto-assigned a regular trip — same full-day reserve the
   *  batch solver applies to its dutyDriverId. A temporal pseudo-trip alone
   *  leaks pre-dawn trips that clear the 08:00–16:00 WERN window, so the
   *  exclusion is enforced here as a hard filter. */
  onCallDriverId?: string | null;
}

export interface MatchResult {
  vehicleId: string;
  primaryDriverId: string;
  secondaryDriverId: string | null;
}

export function match(input: MatchInput): { ok: true; result: MatchResult } | { ok: false; error: MatchError } {
  // A WERN (duty) slot is the day's on-call driver's job — assign them directly,
  // bypassing the fair pick that reserves the duty driver out of every match.
  // No duty rostered → NO_PRIMARY_DRIVER; the duty driver has no car → NO_SLOT.
  if (input.jobType === "WERN") {
    if (!input.onCallDriverId) return { ok: false, error: "NO_PRIMARY_DRIVER" };
    const vehicleId = input.driverCar.get(input.onCallDriverId) ?? null;
    if (!vehicleId) return { ok: false, error: "NO_SLOT" };
    return { ok: true, result: { vehicleId, primaryDriverId: input.onCallDriverId, secondaryDriverId: null } };
  }

  // car=driver: pick the driver first; the vehicle is whatever car that driver
  // is assigned to. Picking the driver IS picking the car.
  const availableIds = new Set(filterAvailable(input.newTrip, input.driverAvailability));
  const eligible = input.driverRankInputs.filter(
    (r) => availableIds.has(r.driverId) && r.driverId !== input.onCallDriverId,
  );
  const ranked = rankCandidates(eligible);
  if (ranked.length === 0) return { ok: false, error: "NO_PRIMARY_DRIVER" };

  // car=driver: the PRIMARY supplies the car, so pick the fairest ranked driver
  // who actually has one — skipping an unpaired (e.g. just-added) top pick rather
  // than dead-ending on NO_SLOT while a paired driver below sits idle. Only if
  // NONE of the eligible drivers have a car is it genuinely NO_SLOT.
  const primaryDriverId = ranked.find((id) => input.driverCar.has(id)) ?? null;
  if (!primaryDriverId) return { ok: false, error: "NO_SLOT" };
  const vehicleId = input.driverCar.get(primaryDriverId)!;

  const needSecondary =
    input.estimatedDistance !== null && input.estimatedDistance > LONG_TRIP_KM;
  let secondaryDriverId: string | null = null;
  if (needSecondary) {
    // The co-driver rides in the primary's car, so they need not be paired —
    // just the next-fairest eligible driver after the primary.
    secondaryDriverId = ranked.find((id) => id !== primaryDriverId) ?? null;
    if (!secondaryDriverId) return { ok: false, error: "NO_SECONDARY_DRIVER" };
  }

  return {
    ok: true,
    result: { vehicleId, primaryDriverId, secondaryDriverId },
  };
}
