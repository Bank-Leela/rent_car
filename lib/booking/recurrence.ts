import { addDays, isSameDay } from "date-fns";

/**
 * Phase-5 recurrence: pick weekdays-of-week + a date range, expand to dates.
 * 0 = Sunday, 6 = Saturday — JavaScript convention.
 */
export function expandRecurringDates({
  startDate,
  endDate,
  weekdays,
}: {
  startDate: Date;
  endDate: Date;
  weekdays: number[];
}): Date[] {
  if (startDate > endDate) return [];
  const set = new Set(weekdays);
  const out: Date[] = [];
  let cursor = startDate;
  // Cap at 366 to avoid runaway loops on bad input.
  for (let i = 0; i < 366 && cursor <= endDate; i++) {
    if (set.has(cursor.getUTCDay()) || set.has(cursor.getDay())) {
      out.push(new Date(cursor));
    }
    cursor = addDays(cursor, 1);
    if (isSameDay(cursor, addDays(startDate, 366))) break;
  }
  return out;
}

export function buildRrule(weekdays: number[]): string {
  const ical = weekdays
    .map((d) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][d])
    .filter(Boolean);
  return `RRULE:FREQ=WEEKLY;BYDAY=${ical.join(",")}`;
}
