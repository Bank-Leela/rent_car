// Shared calendar vehicle-conflict detection, used by the month grid and the
// day view. Two bookings sharing a vehicle within VEHICLE_BUFFER_MINUTES
// edge-to-edge (or overlapping) conflict. Same logic both places used to
// duplicate; extracted verbatim (behavior-preserving).

import { VEHICLE_BUFFER_MINUTES } from "@/lib/booking/rules";

export const LIVE_STATUSES = new Set(["PENDING_APPROVAL", "APPROVED", "ASSIGNED"]);

export type DayBooking = {
  id: string;
  vehicleId: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
};

/** Ids of bookings that share a vehicle with another within the buffer window. */
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
    list.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!;
      const curr = list[i]!;
      const gapMin = (curr.startAt.getTime() - prev.endAt.getTime()) / 60000;
      if (gapMin < VEHICLE_BUFFER_MINUTES) {
        ids.add(prev.id);
        ids.add(curr.id);
      }
    }
  }
  return ids;
}
