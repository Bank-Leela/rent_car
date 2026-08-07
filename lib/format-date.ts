import { format as dateFnsFormat } from "date-fns";
import { th } from "date-fns/locale";

// Thai-only date formatting.
//
// date-fns defaults to English for every locale-sensitive token (EEE, EEEE, MMM,
// MMMM). Twenty-one call sites across ten pages had omitted `{ locale: th }`, so
// a Thai-only UI printed "Thu 20 Aug 2026" on the booking detail, the driver
// kiosk header, the admin decisions log and the dashboard range.
//
// Patching those call sites individually would fix today and lose again the next
// time someone types `format(`. This wrapper removes the option to forget: the
// locale is not a parameter, because with `locales = ["th"]` there is no other
// answer. If a second locale is ever added, this is the one place to thread it.
export function formatTh(date: Date | number, pattern: string): string {
  return dateFnsFormat(date, pattern, { locale: th });
}
