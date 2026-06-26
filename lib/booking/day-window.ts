import { startOfDay, addDays } from "date-fns";

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

// Airline-style day-offset marker relative to the viewed day: "" for same day,
// "⁺1"/"⁺2" for later days, "⁻1" for earlier — e.g. an 18:00 arrival on the day
// after the viewed one renders "18:00⁺1". viewedDayStart is the local midnight.
const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};
export function daySuperscript(d: Date, viewedDayStart: Date): string {
  const n = Math.round((startOfDay(d).getTime() - viewedDayStart.getTime()) / 86_400_000);
  if (n === 0) return "";
  return (n > 0 ? "⁺" : "⁻") + String(Math.abs(n)).split("").map((c) => SUP[c] ?? c).join("");
}

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

// Every calendar day (local midnight) that the trip [startAt, endAt) touches,
// clamped to the [rangeStart, rangeEnd] window — for bucketing a multi-day trip
// into every month-grid cell it spans, not only its departure day. A trip ending
// exactly on a day's midnight does NOT count that day (endAt > dayMidnight),
// matching daySpan's continuesAfter semantics.
export function daysSpanned(startAt: Date, endAt: Date, rangeStart: Date, rangeEnd: Date): Date[] {
  const out: Date[] = [];
  const first = startOfDay(startAt < rangeStart ? rangeStart : startAt);
  const last = startOfDay(rangeEnd);
  for (let cur = first; cur <= last; cur = addDays(cur, 1)) {
    const next = addDays(cur, 1);
    if (startAt < next && endAt > cur) out.push(cur);
  }
  return out;
}
