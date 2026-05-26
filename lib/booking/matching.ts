// CR-06 Matching: combines Algorithm 1 (slot allocation) and Algorithm 2
// (driver capacity) and produces a (vehicle, primary, [secondary?])
// assignment. Pure orchestration; DB I/O lives in matching-actions.ts.

import type { JobType, TimeBucket } from "@prisma/client";
import { findSlot, type SlotCell } from "./slot-allocation";
import {
  filterAvailable,
  rankCandidates,
  type DriverAvailabilityInput,
  type DriverMatrixCell,
  type RankInput,
  type TripWindow,
} from "./driver-capacity";

export type MatchError =
  | "NO_SLOT"
  | "NO_PRIMARY_DRIVER"
  | "NO_SECONDARY_DRIVER";

export interface MatchInput {
  jobType: JobType;
  timeBucket: TimeBucket;
  newTrip: TripWindow;
  estimatedDistance: number | null;
  slotTable: SlotCell[][];
  /** UI snapshot of current driver loads. Not used as a hard filter; see
   *  driverAvailability for the temporal rule. */
  driverMatrix: DriverMatrixCell[][];
  driverAvailability: DriverAvailabilityInput[];
  driverRankInputs: RankInput[];
}

export interface MatchResult {
  vehicleId: string;
  primaryDriverId: string;
  secondaryDriverId: string | null;
}

export const LONG_TRIP_KM = 400;

export function match(input: MatchInput): { ok: true; result: MatchResult } | { ok: false; error: MatchError } {
  const slot = findSlot(input.timeBucket, input.slotTable);
  if (!slot) return { ok: false, error: "NO_SLOT" };

  const availableIds = new Set(filterAvailable(input.newTrip, input.driverAvailability));
  const eligible = input.driverRankInputs.filter((r) => availableIds.has(r.driverId));
  const ranked = rankCandidates(eligible);
  if (ranked.length === 0) return { ok: false, error: "NO_PRIMARY_DRIVER" };

  const primaryDriverId = ranked[0]!;
  const needSecondary =
    input.estimatedDistance !== null && input.estimatedDistance > LONG_TRIP_KM;
  let secondaryDriverId: string | null = null;
  if (needSecondary) {
    if (ranked.length < 2) return { ok: false, error: "NO_SECONDARY_DRIVER" };
    secondaryDriverId = ranked[1]!;
  }

  return {
    ok: true,
    result: { vehicleId: slot.vehicleId, primaryDriverId, secondaryDriverId },
  };
}
