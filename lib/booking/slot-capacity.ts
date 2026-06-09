// #1 submit-time capacity gate ("first N slots guaranteed, rest waitlist").
//
// A day's capacity = one morning + one afternoon slot per active non-duty
// vehicle (5 cars → 10), PLUS one spare slot for the เวร/duty car (which is
// otherwise busy on campus rounds). So 5 non-duty + 1 duty → 11 slots/day.
// When the day's guaranteed slots are full, a new request is WAITLISTed for
// P'Top to fit or deny. Independent of the later admin-side batch matching.
import { BookingStatus } from "@prisma/client";

const MORNING_CUTOFF_HOUR = 12;

export type DayHalf = "MORNING" | "AFTERNOON";

// A booking in one of these statuses occupies a slot for its day.
// WAITLIST / DRAFT / CANCELLED / DENIED do not hold a slot.
export const SLOT_HOLDING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.APPROVED,
  BookingStatus.ASSIGNED,
  BookingStatus.COMPLETED,
];

// Used only by the schedule board to place a booking in a morning/afternoon
// column; not part of the capacity count itself.
export function bookingHalf(startAt: Date): DayHalf {
  return startAt.getHours() < MORNING_CUTOFF_HOUR ? "MORNING" : "AFTERNOON";
}

// Local-day window [start, end) for filtering same-day bookings.
export function dayWindow(d: Date): { start: Date; end: Date } {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

// Guaranteed slots in a day: morning + afternoon per non-duty vehicle, plus
// one spare per duty (เวร) vehicle.
export function dayCapacity(nonDutyVehicles: number, dutyVehicles: number): number {
  return nonDutyVehicles * 2 + dutyVehicles;
}

// The day is full once used slots reach capacity. Capacity 0 (no vehicles
// configured) never waitlists — fall back to guaranteed.
export function isFull(usedToday: number, capacity: number): boolean {
  return capacity > 0 && usedToday >= capacity;
}

// Resolve the status a freshly-submitted booking should get given how many
// slot-holding bookings already exist that day.
export function submitStatus(usedToday: number, capacity: number): BookingStatus {
  return isFull(usedToday, capacity)
    ? BookingStatus.WAITLIST
    : BookingStatus.PENDING_APPROVAL;
}
