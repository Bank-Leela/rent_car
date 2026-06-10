// CR-05 Algorithm 1: slot allocation.
//
// A slot is a (vehicle × time bucket) cell on the daily grid. The matcher
// asks this module two things:
//   1. Which bucket does a given booking land in? (bucketFromStart)
//   2. Is the cell (vehicleId, bucket) free on a given date? (buildSlotTable,
//      findSlot)
//
// No driver decisions happen here. Pure functions over already-loaded data.

import type { TimeBucket } from "@prisma/client";

export const TIME_BUCKETS = [
  "BEFORE_08",
  "MORNING_08_12",
  "AFTERNOON_12_16",
  "AFTER_16",
] as const satisfies readonly TimeBucket[];

export interface SlotInput {
  vehicleId: string;
  registrationNumber: string;
  isDutyVehicle: boolean;
}

export interface ExistingTrip {
  vehicleId: string | null;
  timeBucket: TimeBucket;
}

export interface SlotCell {
  vehicleId: string;
  registrationNumber: string;
  bucket: TimeBucket;
  isDutyVehicle: boolean;
  busy: boolean;
}

/** Returns the bucket the given startAt falls into. */
export function bucketFromStart(startAt: Date): TimeBucket {
  const h = startAt.getHours();
  if (h < 8) return "BEFORE_08";
  if (h < 12) return "MORNING_08_12";
  if (h < 16) return "AFTERNOON_12_16";
  return "AFTER_16";
}

// CR-06: duty vehicle's morning + afternoon are always pre-occupied by the
// campus rounds loop (บริหาร / คลัง / HR / สารบัญ). Treat them as busy in
// the slot grid even if no Booking row exists.
const DUTY_PREBLOCKED_BUCKETS: ReadonlySet<TimeBucket> = new Set([
  "MORNING_08_12",
  "AFTERNOON_12_16",
]);

/**
 * Builds the slot grid for a given day. Rows = vehicles (duty vehicles last,
 * stable by registration), columns = the four buckets.
 */
export function buildSlotTable(
  vehicles: SlotInput[],
  existing: ExistingTrip[],
): SlotCell[][] {
  const busy = new Set<string>();
  for (const t of existing) {
    if (t.vehicleId) busy.add(`${t.vehicleId}::${t.timeBucket}`);
  }
  const sorted = [...vehicles].sort((a, b) => {
    if (a.isDutyVehicle !== b.isDutyVehicle) return a.isDutyVehicle ? 1 : -1;
    return a.registrationNumber.localeCompare(b.registrationNumber);
  });
  return sorted.map((v) =>
    TIME_BUCKETS.map((bucket) => ({
      vehicleId: v.vehicleId,
      registrationNumber: v.registrationNumber,
      bucket,
      isDutyVehicle: v.isDutyVehicle,
      busy:
        busy.has(`${v.vehicleId}::${bucket}`) ||
        (v.isDutyVehicle && DUTY_PREBLOCKED_BUCKETS.has(bucket)),
    })),
  );
}

/**
 * First free cell in the requested bucket, preferring non-duty vehicles.
 * Returns null if every vehicle is busy in that bucket.
 */
export function findSlot(bucket: TimeBucket, table: SlotCell[][]): SlotCell | null {
  for (const row of table) {
    const cell = row.find((c) => c.bucket === bucket);
    if (cell && !cell.busy) return cell;
  }
  return null;
}

/**
 * Vehicle occupancy for `day`, as ExistingTrips for buildSlotTable. A trip that
 * starts before today or ends after today (e.g. a multi-day TJW away out of
 * province) occupies the vehicle for the WHOLE day — every bucket — so it is
 * never handed to another booking. Same-day trips occupy only their own bucket.
 *
 * This is the vehicle-side mirror of the driver-side spanning-TJW handling; the
 * caller must query trips that overlap the day (startAt < dayEnd && endAt >
 * dayStart), not just trips that start on the day.
 */
export function vehicleOccupancyForDay(
  trips: Array<{ vehicleId: string | null; startAt: Date; endAt: Date; timeBucket: TimeBucket }>,
  day: Date,
): ExistingTrip[] {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const out: ExistingTrip[] = [];
  for (const t of trips) {
    if (!t.vehicleId) continue;
    const spansWholeDay = t.startAt < dayStart || t.endAt > dayEnd;
    if (spansWholeDay) {
      for (const bucket of TIME_BUCKETS) out.push({ vehicleId: t.vehicleId, timeBucket: bucket });
    } else {
      out.push({ vehicleId: t.vehicleId, timeBucket: t.timeBucket });
    }
  }
  return out;
}

/**
 * Assigns a free vehicle to each booking, reserving as it goes. Bookings whose
 * bucket has no free vehicle land in `noVehicle` — the caller must overflow
 * them (NO_SLOT), never persist them ASSIGNED with a null vehicle. The driver
 * solver is independent of vehicle capacity, so it can over-assign a bucket;
 * this is where that surfaces instead of silently producing a carless driver.
 */
export function allocateVehicles<T extends { bookingId: string }>(
  items: T[],
  bucketOf: (bookingId: string) => TimeBucket,
  table: SlotCell[][],
): { withVehicle: Array<{ item: T; vehicleId: string }>; noVehicle: T[] } {
  const withVehicle: Array<{ item: T; vehicleId: string }> = [];
  const noVehicle: T[] = [];
  for (const item of items) {
    const slot = findSlot(bucketOf(item.bookingId), table);
    if (slot) {
      slot.busy = true; // reserve so later items don't reuse it
      withVehicle.push({ item, vehicleId: slot.vehicleId });
    } else {
      noVehicle.push(item);
    }
  }
  return { withVehicle, noVehicle };
}
