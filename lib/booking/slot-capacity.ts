// #1 submit-time capacity gate ("first 10 slots guaranteed, rest waitlist").
//
// Each day has morning + afternoon slots, one of each per active non-duty
// vehicle (the เวร/duty car is excluded). When a half-day's slots are already
// taken, a new request for that half lands on the WAITLIST instead of being
// guaranteed. This is independent of the later admin-side batch matching.
import { BookingStatus } from "@prisma/client";

const MORNING_CUTOFF_HOUR = 12;

export type DayHalf = "MORNING" | "AFTERNOON";

// A booking in one of these statuses occupies a slot for its day + half.
// WAITLIST / DRAFT / CANCELLED / DENIED do not hold a slot.
export const SLOT_HOLDING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.APPROVED,
  BookingStatus.ASSIGNED,
  BookingStatus.COMPLETED,
];

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

// The half is full once used slots reach the per-half capacity. A capacity of
// 0 (no job vehicles configured) never waitlists — fall back to guaranteed.
export function isHalfFull(usedInHalf: number, capacityPerHalf: number): boolean {
  return capacityPerHalf > 0 && usedInHalf >= capacityPerHalf;
}

// Resolve the status a freshly-submitted booking should get given how many
// slot-holding bookings already exist in its day+half.
export function submitStatus(
  usedInHalf: number,
  capacityPerHalf: number,
): BookingStatus {
  return isHalfFull(usedInHalf, capacityPerHalf)
    ? BookingStatus.WAITLIST
    : BookingStatus.PENDING_APPROVAL;
}
