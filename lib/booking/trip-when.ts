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
