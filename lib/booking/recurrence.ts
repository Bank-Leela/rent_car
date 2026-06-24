import { addDays, startOfDay } from "date-fns";

/**
 * Phase-5 recurrence: pick weekdays-of-week + a date range, expand to dates.
 * 0 = Sunday, 6 = Saturday — JavaScript LOCAL convention (matches the form's
 * weekday picker and the local datetime-local inputs).
 *
 * Works purely in calendar days: both bounds are normalised to local midnight
 * so the comparison can't be thrown off by the start's time-of-day or by an
 * end date that arrived at a different instant (e.g. a date-only value). The
 * weekday test uses the LOCAL day only — mixing in getUTCDay() used to leak the
 * next calendar day for early-morning starts in +07.
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
  const end = startOfDay(endDate);
  let cursor = startOfDay(startDate);
  if (cursor > end) return [];
  const set = new Set(weekdays);
  const out: Date[] = [];
  // Cap at 366 to avoid runaway loops on bad input.
  for (let i = 0; i < 366 && cursor <= end; i++) {
    if (set.has(cursor.getDay())) out.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function buildRrule(weekdays: number[]): string {
  const ical = weekdays
    .map((d) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][d])
    .filter(Boolean);
  return `RRULE:FREQ=WEEKLY;BYDAY=${ical.join(",")}`;
}
