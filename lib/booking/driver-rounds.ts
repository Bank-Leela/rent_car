// Whiteboard-style "rounds of driving" view model.
//
// The wall whiteboard this replaces lists one row per driver, and each row grows
// left→right with that day's rounds: departure time, where they went, return time.
// This module is the PURE mapping from the day's bookings to that shape — no I/O,
// no scheduling decisions. Assignment is still decided entirely by the solver
// (batch / TJW passes); this only re-presents what was already assigned.

import type { JobType } from "@prisma/client";

export type RoundState = "upcoming" | "inProgress" | "done";

export interface RoundsBookingInput {
  id: string;
  jobNumber: string;
  destination: string;
  startAt: Date;
  endAt: Date;
  jobType: JobType;
  primaryDriverId: string | null;
  secondaryDriverId: string | null;
  /** Trip actuals, when the driver has started/finished. */
  tripStartedAt?: Date | null;
  tripEndedAt?: Date | null;
}

export interface RoundsDriverInput {
  driverId: string;
  driverName: string | null;
  registrationNumber: string | null;
}

export interface DriverRound {
  bookingId: string;
  jobNumber: string;
  /** "HH:mm" departure, or the clamped day edge for a trip that began earlier. */
  startLabel: string;
  endLabel: string;
  place: string;
  jobType: JobType;
  /** This driver rides as the co-driver (the trip runs on the primary's car). */
  isCoDriver: boolean;
  state: RoundState;
  /** Multi-day trip that started before / ends after the viewed day. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface DriverRoundsRow {
  driverId: string;
  driverName: string | null;
  registrationNumber: string | null;
  isDuty: boolean;
  rounds: DriverRound[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function stateOf(b: RoundsBookingInput): RoundState {
  if (b.tripEndedAt) return "done";
  if (b.tripStartedAt) return "inProgress";
  return "upcoming";
}

/**
 * Group the viewed day's bookings into per-driver rounds, ordered by departure.
 *
 * - Every supplied driver gets a row, even with no trips (the whiteboard shows
 *   idle drivers too — an empty row is information).
 * - A driver appears on a trip as primary OR co-driver; co-driver rounds are
 *   flagged so the board can mark that they ride in the primary's car.
 * - A multi-day trip spanning the day is clamped to the day edges and flagged
 *   continuesBefore/After, matching how the timeline board projects it.
 */
export function buildDriverRounds(input: {
  drivers: RoundsDriverInput[];
  bookings: RoundsBookingInput[];
  dayStart: Date;
  dayEnd: Date;
  dutyDriverId: string | null;
}): DriverRoundsRow[] {
  const { drivers, bookings, dayStart, dayEnd, dutyDriverId } = input;

  const byDriver = new Map<string, DriverRound[]>();
  for (const d of drivers) byDriver.set(d.driverId, []);

  const push = (driverId: string | null, b: RoundsBookingInput, isCoDriver: boolean) => {
    if (!driverId) return;
    const list = byDriver.get(driverId);
    if (!list) return; // not in the shown pool (inactive / unpaired)
    const continuesBefore = b.startAt < dayStart;
    const continuesAfter = b.endAt > dayEnd;
    list.push({
      bookingId: b.id,
      jobNumber: b.jobNumber,
      startLabel: continuesBefore ? hhmm(dayStart) : hhmm(b.startAt),
      endLabel: continuesAfter ? hhmm(dayEnd) : hhmm(b.endAt),
      place: b.destination,
      jobType: b.jobType,
      isCoDriver,
      state: stateOf(b),
      continuesBefore,
      continuesAfter,
    });
  };

  for (const b of bookings) {
    push(b.primaryDriverId, b, false);
    push(b.secondaryDriverId, b, true);
  }

  return drivers.map((d) => ({
    driverId: d.driverId,
    driverName: d.driverName,
    registrationNumber: d.registrationNumber,
    isDuty: d.driverId === dutyDriverId,
    rounds: (byDriver.get(d.driverId) ?? []).sort(
      (a, z) => a.startLabel.localeCompare(z.startLabel) || a.jobNumber.localeCompare(z.jobNumber),
    ),
  }));
}
