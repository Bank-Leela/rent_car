// Project a booking's [startAt, endAt) onto a single viewed day so the scheduler
// board can render multi-day trips on every day they span — not only the day they
// start. A trip spilling past either edge of the viewed day is clamped to the
// axis (0 / 24) and flagged, so the board shows "↪ continued from" / "↩ returns".
//
// Hours are local clock hours (the board axis is local 00:00–24:00), matching the
// rest of the board. `dayStart`/`dayEnd` are the viewed day's local midnight
// boundaries (dayEnd exclusive).
export type DaySpan = {
  startHour: number; // 0..24, clamped to the viewed day
  endHour: number; // 0..24; 24 means the trip runs to (or past) the day's end
  continuesBefore: boolean; // the trip started on an earlier day
  continuesAfter: boolean; // the trip ends on a later day
};

const localHour = (d: Date) => d.getHours() + d.getMinutes() / 60;

export function daySpan(startAt: Date, endAt: Date, dayStart: Date, dayEnd: Date): DaySpan {
  const continuesBefore = startAt < dayStart;
  // Strictly after the day's last instant — a trip ending exactly at midnight
  // (endAt === dayEnd) closes the day, it does not continue into the next one.
  const continuesAfter = endAt > dayEnd;
  const startHour = continuesBefore ? 0 : localHour(startAt);
  // Pin to the right edge when the trip reaches the day's end (continues past it,
  // or lands exactly on midnight where localHour() would wrongly read 0).
  const endHour = endAt >= dayEnd ? 24 : localHour(endAt);
  return { startHour, endHour, continuesBefore, continuesAfter };
}
