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

const BUCKET_HOURS: Record<TimeBucket, readonly [number, number]> = {
  BEFORE_08: [0, 8],
  MORNING_08_12: [8, 12],
  AFTERNOON_12_16: [12, 16],
  AFTER_16: [16, 24],
};

/**
 * Every bucket a trip's `[startAt, endAt]` overlaps on `day` (clamped to that
 * day). A same-day trip yields its real buckets — a long trip occupies more
 * than one (e.g. 05:00–09:00 → before-08 + morning), and a trip spanning beyond
 * the day yields all four. The vehicle is busy in every bucket it returns, so a
 * long trip never leaks its vehicle to a later slot the same day.
 */
export function bucketsForTrip(startAt: Date, endAt: Date, day: Date): TimeBucket[] {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayMs = dayStart.getTime();
  const s = Math.max(startAt.getTime(), dayMs);
  const e = Math.min(endAt.getTime(), dayMs + 86_400_000);
  const out: TimeBucket[] = [];
  for (const bucket of TIME_BUCKETS) {
    const [sh, eh] = BUCKET_HOURS[bucket];
    const bs = dayMs + sh * 3_600_000;
    const be = dayMs + eh * 3_600_000;
    if (s < be && e > bs) out.push(bucket);
  }
  return out;
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
 * Vehicle occupancy for `day`, as ExistingTrips for buildSlotTable: each trip
 * marks its vehicle busy in EVERY bucket it overlaps (bucketsForTrip), so a long
 * same-day trip or a multi-day TJW away out of province is never handed to
 * another booking. The caller must query trips that overlap the day
 * (startAt < dayEnd && endAt > dayStart), not just trips that start on the day.
 */
export function vehicleOccupancyForDay(
  trips: Array<{ vehicleId: string | null; startAt: Date; endAt: Date }>,
  day: Date,
): ExistingTrip[] {
  const out: ExistingTrip[] = [];
  for (const t of trips) {
    if (!t.vehicleId) continue;
    for (const timeBucket of bucketsForTrip(t.startAt, t.endAt, day)) {
      out.push({ vehicleId: t.vehicleId, timeBucket });
    }
  }
  return out;
}

/**
 * Assigns a free vehicle to each booking, reserving as it goes. `bucketsOf`
 * gives every bucket a booking's trip occupies (via bucketsForTrip) — a vehicle
 * is taken only if free in ALL of them, and reserved in all of them, so a long
 * trip never leaks its vehicle to a later slot the same day. Bookings with no
 * vehicle free across their span land in `noVehicle` — the caller must overflow
 * them (NO_SLOT), never persist them ASSIGNED with a null vehicle. The driver
 * solver is independent of vehicle capacity, so it can over-assign; this is
 * where that surfaces instead of silently producing a carless driver.
 */
export function allocateVehicles<T extends { bookingId: string }>(
  items: T[],
  bucketsOf: (bookingId: string) => TimeBucket[],
  table: SlotCell[][],
): { withVehicle: Array<{ item: T; vehicleId: string }>; noVehicle: T[] } {
  const withVehicle: Array<{ item: T; vehicleId: string }> = [];
  const noVehicle: T[] = [];
  for (const item of items) {
    const vehicleId = reserveVehicle(bucketsOf(item.bookingId), table);
    if (vehicleId) withVehicle.push({ item, vehicleId });
    else noVehicle.push(item);
  }
  return { withVehicle, noVehicle };
}

/**
 * First vehicle (row) free in ALL the given buckets; marks those cells busy and
 * returns its id, or null if none fits. Non-duty preferred (table is sorted
 * duty-last). Empty bucket list → null (a trip must occupy at least one bucket).
 */
function reserveVehicle(buckets: TimeBucket[], table: SlotCell[][]): string | null {
  if (buckets.length === 0) return null;
  for (const row of table) {
    const cells = buckets.map((b) => row.find((c) => c.bucket === b)!);
    if (cells.every((c) => !c.busy)) {
      for (const c of cells) c.busy = true;
      return cells[0]!.vehicleId;
    }
  }
  return null;
}
