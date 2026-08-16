import Link from "next/link";
import { addMonths, format, isSameDay, isSameMonth, subMonths } from "date-fns";
import { th, enUS, type Locale } from "date-fns/locale";
import { getLocale, getTranslations } from "next-intl/server";

// A month grid of who/what is out each day. Rendered on two pages that ask
// different questions of the same rows, which is why the labels are the caller's
// to choose: /admin/fleet asks "how many cars are left on the 24th" and passes
// plates (car = driver, so a driver on leave is a parked car), /admin/drivers
// asks "who is off" and passes names. No list of leave blocks answers either —
// both are questions about a shape across a month.
//
// Presentational: the page owns the query and hands over one entry per day, so
// the @db.Date → local-day conversion happens once, at the read. The empty line
// is a prop for the same reason the names are: this component reached into the
// `fleet` namespace for it and said "all cars available" on a page about people.

export type LeaveDay = {
  /** yyyy-MM-dd, already converted to the local day. */
  iso: string;
  /** What is out that day — a plate where the driver has a car, else their name. */
  names: string[];
};

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Names shown in a cell before it collapses to "+n". */
const MAX_NAMES = 3;

export async function LeaveCalendar({
  days,
  monthAnchor,
  leave,
  basePath,
  param,
  emptyLabel,
  anchorId = "leave-calendar",
}: {
  /** Every day of the grid, including the leading/trailing days of the
      neighbouring months. */
  days: Date[];
  monthAnchor: Date;
  leave: LeaveDay[];
  /** Where the month links point (this panel is embedded in a bigger page). */
  basePath: string;
  /** Query param the month links set, so it can coexist with other params. */
  param: string;
  /** Shown when the whole month is clear — the caller's copy, since only the
      page knows whether "nobody is off" means cars or people. */
  emptyLabel: string;
  /** Scroll target for the month links. Distinct per page so two calendars can
      never fight over one id. */
  anchorId?: string;
}) {
  const t = await getTranslations("calendar");
  const localeCode = await getLocale();
  const loc: Locale = localeCode.toLowerCase().startsWith("th") ? th : enUS;
  const today = new Date();

  const byDay = new Map(leave.map((d) => [d.iso, d.names]));
  const monthLink = (value?: string) =>
    `${basePath}${value ? `?${param}=${value}` : ""}#${anchorId}`;

  return (
    <div id={anchorId} className="space-y-3 scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{format(monthAnchor, "MMMM yyyy", { locale: loc })}</p>
        <div className="flex items-center gap-1.5">
          <Link
            href={monthLink(format(subMonths(monthAnchor, 1), "yyyy-MM"))}
            className="rounded-md border bg-background px-2.5 py-1 text-xs hover:bg-muted"
          >
            ← {format(subMonths(monthAnchor, 1), "MMM", { locale: loc })}
          </Link>
          <Link
            href={monthLink()}
            className="rounded-md border bg-background px-2.5 py-1 text-xs hover:bg-muted"
          >
            {t("thisMonth")}
          </Link>
          <Link
            href={monthLink(format(addMonths(monthAnchor, 1), "yyyy-MM"))}
            className="rounded-md border bg-background px-2.5 py-1 text-xs hover:bg-muted"
          >
            {format(addMonths(monthAnchor, 1), "MMM", { locale: loc })} →
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          {WEEKDAY_KEYS.map((k) => (
            <div key={k} className="px-2 py-1.5">
              {t(`weekdayHeaders.${k}`)}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const iso = format(day, "yyyy-MM-dd");
            const names = byDay.get(iso) ?? [];
            const inMonth = isSameMonth(day, monthAnchor);
            const isToday = isSameDay(day, today);
            return (
              <div
                key={iso}
                className={`min-h-20 border-t border-l p-1 ${
                  inMonth
                    ? "bg-card"
                    : "bg-muted/40 text-muted-foreground/70 dark:bg-white/2 dark:text-muted-foreground/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={
                      isToday
                        ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-foreground"
                        : "px-1 text-xs tabular-nums"
                    }
                  >
                    {format(day, "d")}
                  </span>
                  {/* The count, not just the names: "3 off" is the number that
                      decides whether the day can take another trip. */}
                  {names.length > 0 && (
                    <span className="rounded bg-urgent-surface px-1 text-[10px] font-medium tabular-nums text-urgent-foreground">
                      {names.length}
                    </span>
                  )}
                </div>
                <ul className="mt-0.5 space-y-0.5">
                  {names.slice(0, MAX_NAMES).map((n) => (
                    <li
                      key={n}
                      title={n}
                      className="truncate rounded border border-urgent/40 bg-urgent-surface px-1 text-[11px] text-urgent-foreground"
                    >
                      {n}
                    </li>
                  ))}
                  {names.length > MAX_NAMES && (
                    <li className="px-1 text-[10px] text-muted-foreground">
                      +{names.length - MAX_NAMES}
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {leave.length === 0 && (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  );
}
