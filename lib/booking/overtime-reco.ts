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

import { WORK_DAY_START_HOUR, WORK_DAY_END_HOUR, isOvernight } from "./classification";
import { canChain } from "./rotations";

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
  // A cross-midnight trip is overnight = OT (classifyJobType §2); the hour checks
  // below are blind to the calendar date, so test this first — otherwise a
  // 22:00→02:00 OT reads as "ends at 02:00 ≤ 16:00" and is wrongly skipped.
  if (isOvernight(startAt, endAt)) return true;
  if (startAt.getHours() < WORK_DAY_START_HOUR) return true;
  if (endAt.getHours() > WORK_DAY_END_HOUR) return true;
  return endAt.getHours() === WORK_DAY_END_HOUR && endAt.getMinutes() > 0;
}

export function recommendOvertimePlacement(input: OvertimeRecoInput): OvertimeReco {
  const { booking, dutyDriverId, drivers } = input;

  if (!isOvertimeWindow(booking.startAt, booking.endAt)) return { kind: "not-applicable" };

  // Fairest non-duty car-driver unit that can legally take this OT: has a car,
  // and clears the chaining rule for an OT (no overlap + ≥2h gap to every other
  // trip). canChain with jobType OT skips the 2-NORMAL cap — overtime is extra
  // hours on top — but still enforces the 2h gap.
  const driver = drivers
    .filter((d) => d.driverId !== dutyDriverId)
    .filter((d) => d.vehicleId)
    .filter((d) => canChain({ startAt: booking.startAt, endAt: booking.endAt, jobType: "OT" }, d.trips))
    .sort(
      (a, b) =>
        a.earningsScore - b.earningsScore ||
        (a.lastAssignedAt?.getTime() ?? -Infinity) - (b.lastAssignedAt?.getTime() ?? -Infinity) ||
        a.driverId.localeCompare(b.driverId),
    )[0];
  if (!driver) return { kind: "no-fit" };

  return { kind: "overtime-fit", driverId: driver.driverId, vehicleId: driver.vehicleId! };
}
