// CR-05: time-bucket classifier.
//
// The vehicle slot grid (buildSlotTable / findSlot / vehicleOccupancyForDay /
// allocateVehicles) was retired by the car=driver model — a booking's vehicle
// is its driver's assigned car, so there is no vehicle×bucket allocation.
// Only the bucket classifier survives in production (used by actions.ts).
// SlotInput / ExistingTrip remain as types for the matcher simulation script.

import type { TimeBucket } from "@prisma/client";

export interface SlotInput {
  vehicleId: string;
  registrationNumber: string;
  isDutyVehicle: boolean;
}

export interface ExistingTrip {
  vehicleId: string | null;
  timeBucket: TimeBucket;
}

/** Returns the bucket the given startAt falls into. */
export function bucketFromStart(startAt: Date): TimeBucket {
  const h = startAt.getHours();
  if (h < 8) return "BEFORE_08";
  if (h < 12) return "MORNING_08_12";
  if (h < 16) return "AFTERNOON_12_16";
  return "AFTER_16";
}
