// Shared calendar vehicle-conflict detection, used by the month grid and the day
// view. Two bookings sharing a vehicle within VEHICLE_BUFFER_MINUTES edge-to-edge
// (or overlapping) conflict — unless §5c says they may share the car.

import { VEHICLE_BUFFER_MINUTES } from "@/lib/booking/rules";
import { sharesCarWith } from "@/lib/booking/rotations";
import { legsOverlap, minLegGapMinutes, type LegSource } from "@/lib/booking/trip-legs";

export const LIVE_STATUSES = new Set(["PENDING_APPROVAL", "APPROVED", "ASSIGNED"]);

export type DayBooking = {
  id: string;
  vehicleId: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
  /** §5c — two campus errands ten minutes apart legitimately share one car. */
  travelWithinChula?: boolean;
  // No-wait split. A trip that drops off and comes back later frees its middle,
  // and the car is genuinely available in that gap.
  waitAtDestination?: boolean;
  dropOffDone?: Date | null;
  pickupReturnTime?: string | null;
};

const toLeg = (b: DayBooking): LegSource => ({
  startAt: b.startAt,
  endAt: b.endAt,
  waitAtDestination: b.waitAtDestination ?? true,
  dropOffDone: b.dropOffDone ?? null,
  pickupReturnTime: b.pickupReturnTime ?? null,
});

/**
 * Ids of bookings that share a vehicle with another within the buffer window.
 *
 * This is the badge P'Top scans a whole month with, so a miss here is a conflict
 * nobody is told about. Three things it used to get wrong:
 *
 *  1. It compared ADJACENT PAIRS only, after sorting by startAt. A trip contained
 *     inside a longer one was invisible whenever a nearer neighbour sat between
 *     them: A 08:00-18:00, B 09:00-09:30, C 17:00-17:30 on one car flagged A and B
 *     and said nothing about C, which is inside A. Every pair is compared now —
 *     the lists are a single day's trips on a single car, so the quadratic cost is
 *     a handful of comparisons.
 *
 *  2. It applied a flat buffer with no §5c branch, so once the database began
 *     permitting two in-Chula errands on one car, every legitimately shared campus
 *     run rendered a permanent red conflict that no action could clear.
 *
 *  3. It ignored the no-wait leg split entirely, unlike every other overlap check
 *     in the system, so a car free between legs read as busy.
 */
export function conflictingBookingIds(items: DayBooking[]): Set<string> {
  const ids = new Set<string>();
  const byVehicle = new Map<string, DayBooking[]>();
  for (const b of items) {
    if (!b.vehicleId || !LIVE_STATUSES.has(b.status)) continue;
    const list = byVehicle.get(b.vehicleId) ?? [];
    list.push(b);
    byVehicle.set(b.vehicleId, list);
  }
  for (const list of byVehicle.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        // §5c partners are not in conflict — they are the intended arrangement.
        if (sharesCarWith(a, b)) continue;
        const legA = toLeg(a);
        const legB = toLeg(b);
        if (legsOverlap(legA, legB) || minLegGapMinutes(legA, legB) < VEHICLE_BUFFER_MINUTES) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
  }
  return ids;
}
