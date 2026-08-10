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
  destination: string;
  startAt: Date;
  endAt: Date;
  jobType: JobType;
  primaryDriverId: string | null;
  secondaryDriverId: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  /** Trip actuals, when the driver has started/finished. */
  tripStartedAt?: Date | null;
  tripEndedAt?: Date | null;
}

export interface RoundsDriverInput {
  driverId: string;
  driverName: string | null;
  registrationNumber: string | null;
}

/**
 * Which day of a multi-day trip this is, from the viewed day's point of view.
 *
 * A trip that spans nights can't be described by a start and end time on every
 * day it covers — on a middle day there is no departure and no return, the
 * driver is simply away. Clamping to the day boundary produced "00:00–00:00",
 * which reads as a zero-length midnight trip rather than "gone". Each day now
 * states what is true on THAT day.
 */
export type RoundPhase = "single" | "depart" | "away" | "return";

export interface DriverRound {
  bookingId: string;
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
  phase: RoundPhase;
  /** Overnight only: which night of the trip this day begins (1-based), and how
   *  many nights the trip runs in total. */
  nightIndex: number | null;
  nightTotal: number | null;
  /** The trip's real departure / return moments, for the "ออก …" / "กลับ …" line. */
  departAt: Date;
  returnAt: Date;
  /** Who the driver is actually collecting, and the number to ring if the pickup
   *  point is wrong or nobody is there. The driver has the trip on the board but
   *  had no way to reach the passenger without opening the booking. */
  contactName: string | null;
  contactPhone: string | null;
}

export interface DriverRoundsRow {
  driverId: string;
  driverName: string | null;
  registrationNumber: string | null;
  isDuty: boolean;
  /** Marked off sick/leave for this day — excluded from the day's auto-assign. */
  isOff: boolean;
  rounds: DriverRound[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Whole calendar days from `a` to `b`, ignoring the time of day. */
function daysBetween(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

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
  /** Drivers marked off (sick/leave) for this day. */
  offDriverIds?: string[];
}): DriverRoundsRow[] {
  const { drivers, bookings, dayStart, dayEnd, dutyDriverId, offDriverIds = [] } = input;

  const byDriver = new Map<string, DriverRound[]>();
  for (const d of drivers) byDriver.set(d.driverId, []);

  const push = (driverId: string | null, b: RoundsBookingInput, isCoDriver: boolean) => {
    if (!driverId) return;
    const list = byDriver.get(driverId);
    if (!list) return; // not in the shown pool (inactive / unpaired)
    const continuesBefore = b.startAt < dayStart;
    const continuesAfter = b.endAt > dayEnd;
    const phase: RoundPhase = continuesBefore
      ? continuesAfter
        ? "away" // neither leaves nor returns today — gone the whole day
        : "return"
      : continuesAfter
        ? "depart"
        : "single";
    // Nights are counted between calendar days, so a 10 Aug 06:00 → 13 Aug 18:00
    // trip is 3 nights, and 11 Aug is the start of night 2.
    const nightTotal = daysBetween(b.startAt, b.endAt);
    const nightIndex = nightTotal > 0 ? daysBetween(b.startAt, dayStart) + 1 : null;
    list.push({
      bookingId: b.id,
      startLabel: continuesBefore ? hhmm(dayStart) : hhmm(b.startAt),
      endLabel: continuesAfter ? hhmm(dayEnd) : hhmm(b.endAt),
      place: b.destination,
      jobType: b.jobType,
      isCoDriver,
      state: stateOf(b),
      continuesBefore,
      continuesAfter,
      phase,
      nightIndex: phase === "away" ? nightIndex : null,
      nightTotal: nightTotal > 0 ? nightTotal : null,
      departAt: b.startAt,
      returnAt: b.endAt,
      contactName: b.contactName ?? null,
      contactPhone: b.contactPhone ?? null,
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
    isOff: offDriverIds.includes(d.driverId),
    // Two rounds leaving at the same minute are ordered by where they go —
    // the only thing on the row that tells them apart.
    rounds: (byDriver.get(d.driverId) ?? []).sort(
      (a, z) => a.startLabel.localeCompare(z.startLabel) || a.place.localeCompare(z.place),
    ),
  }));
}
