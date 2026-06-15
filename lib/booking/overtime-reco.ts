// Overtime placement recommendation (P'Top queue highlight).
//
// The day-capacity gate (slot-capacity.ts) counts NORMAL-day (08:00–16:00)
// slots and is time-blind, so it waitlists an OT that runs OUTSIDE that window
// (early / evening) even though it is overtime on top of the normal day — a
// driver booked 08:00–16:00 is free again at 20:00. For such a waitlisted
// booking this finds a genuinely-free non-duty car-driver unit at the booking's
// real time and recommends it. Advisory only — pure, no I/O.
//
// car=driver: a car is busy iff its driver is busy, so "a free car" collapses
// into "a free driver who has a car". No separate slot grid.

import { WORK_DAY_START_HOUR, WORK_DAY_END_HOUR } from "./classification";

export interface OvertimeRecoDriver {
  driverId: string;
  /** The driver's assigned car (car=driver). null = unpaired → not recommendable. */
  vehicleId: string | null;
  /** Duration-weighted fairness ledger — lower picked first. */
  earningsScore: number;
  lastAssignedAt: Date | null;
  /** The driver's other bookings that day (to check temporal overlap). */
  trips: Array<{ startAt: Date; endAt: Date }>;
}

export interface OvertimeRecoInput {
  booking: { startAt: Date; endAt: Date };
  /** Excluded from candidates — they have done their duty day. */
  dutyDriverId: string | null;
  drivers: OvertimeRecoDriver[];
}

export type OvertimeReco =
  | { kind: "overtime-fit"; driverId: string; vehicleId: string }
  | { kind: "no-fit" }
  | { kind: "not-applicable" };

/** True if the trip runs outside the normal 08:00–16:00 window (= overtime). */
function isOvertimeWindow(startAt: Date, endAt: Date): boolean {
  if (startAt.getHours() < WORK_DAY_START_HOUR) return true;
  if (endAt.getHours() > WORK_DAY_END_HOUR) return true;
  return endAt.getHours() === WORK_DAY_END_HOUR && endAt.getMinutes() > 0;
}

const overlaps = (
  a: { startAt: Date; endAt: Date },
  b: { startAt: Date; endAt: Date },
): boolean => a.startAt < b.endAt && b.startAt < a.endAt;

export function recommendOvertimePlacement(input: OvertimeRecoInput): OvertimeReco {
  const { booking, dutyDriverId, drivers } = input;

  if (!isOvertimeWindow(booking.startAt, booking.endAt)) return { kind: "not-applicable" };

  // Fairest non-duty car-driver unit free at the booking time: has a car, no
  // trip overlapping the booking. The 2-job/day cap is intentionally NOT applied
  // — overtime is extra hours on top of the normal day.
  const driver = drivers
    .filter((d) => d.driverId !== dutyDriverId)
    .filter((d) => d.vehicleId)
    .filter((d) => !d.trips.some((t) => overlaps(t, booking)))
    .sort(
      (a, b) =>
        a.earningsScore - b.earningsScore ||
        (a.lastAssignedAt?.getTime() ?? -Infinity) - (b.lastAssignedAt?.getTime() ?? -Infinity) ||
        a.driverId.localeCompare(b.driverId),
    )[0];
  if (!driver) return { kind: "no-fit" };

  return { kind: "overtime-fit", driverId: driver.driverId, vehicleId: driver.vehicleId! };
}
