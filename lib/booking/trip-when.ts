import { format, isSameDay } from "date-fns";
import { th } from "date-fns/locale";

// One compact "when" string for list cards.
//
// The queue cards used to print the full date on BOTH ends
// ("Wed 5 Aug 08:30 → Wed 5 Aug 11:00"), which is the same date twice and the
// single biggest source of noise on a card. Same-day trips — almost all of them —
// collapse to one date plus a time range; only a genuinely multi-day trip repeats
// the date. Thai locale, because the whole UI is Thai.
export function tripWhen(startAt: Date, endAt: Date): string {
  const day = (d: Date) => format(d, "EEE d MMM", { locale: th });
  const time = (d: Date) => format(d, "HH:mm", { locale: th });
  return isSameDay(startAt, endAt)
    ? `${day(startAt)} ${time(startAt)}–${time(endAt)}`
    : `${day(startAt)} ${time(startAt)} → ${day(endAt)} ${time(endAt)}`;
}

// The same string for a card that ALSO lists every occurrence underneath.
//
// A series card printed the first occurrence's date here and then repeated it as
// the first entry of the date list ("ศ. 14 ส.ค. 08:00–12:00" above
// "14 ส.ค. · 19 ส.ค. · …"). Worse than redundant: the weekday is only the FIRST
// day's, so a series running Tue/Wed/Thu/Fri was labelled ศ. (Friday). The dates
// belong to the list; only the time is shared by every occurrence, so that is all
// this returns.
//
// A trip that spans midnight still needs both dates to be readable, so it keeps
// the full form — the list cannot express "runs into the next day".
export function tripWhenRecurring(startAt: Date, endAt: Date): string {
  if (!isSameDay(startAt, endAt)) return tripWhen(startAt, endAt);
  const time = (d: Date) => format(d, "HH:mm", { locale: th });
  return `${time(startAt)}–${time(endAt)}`;
}
