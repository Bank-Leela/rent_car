import Link from "next/link";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  parse,
} from "date-fns";
import { AlertTriangle } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { th, enUS, type Locale } from "date-fns/locale";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { SelectField } from "@/components/ui/select-field";
import { LIVE_STATUSES, conflictingBookingIds } from "@/lib/booking/calendar-conflicts";
import { daySpan, daysSpanned, type DaySpan } from "@/lib/booking/day-window";
import { STATUS_STYLE, CALENDAR_STATUS_LEGEND } from "@/lib/booking/status-style";
import { formatTh } from "@/lib/format-date";

// Compact month-cell time: ↩<return> on a return day, ↪↩ when away the whole
// day, else the real start time — so a spanned cell never shows a misleading
// prior-day start.
function cellTime(startAt: Date, endAt: Date, span: DaySpan): string {
  if (span.continuesBefore && span.continuesAfter) return "↪↩";
  if (span.continuesBefore) return `↩${format(endAt, "HH:mm")}`;
  return format(startAt, "HH:mm");
}

// How busy the day is, as a wash behind the rows. Deliberately faint: it used to
// run to primary/20–25, which put a saturated indigo field under rows that were
// themselves saturated, and the two colour systems fought — that is most of why
// the grid read as noise. With the rows now neutral this is the only field
// colour on the cell, so it can be much quieter and still be legible.
// How busy the day is, as a wash behind the rows. Deliberately faint: it used to
// run to primary/20–25, which put a saturated indigo field under rows that were
// themselves saturated, and the two colour systems fought — that is most of why
// the grid read as noise. With the rows now neutral this is the only field
// colour on the cell, so it can be much quieter and still be legible.
//
// Returned as an OVERLAY class, not as a background for the cell itself. Both
// this and `bg-card` set background-color, so putting them on one element does
// not layer them — the later utility in the generated stylesheet simply wins.
// It was winning: a busy cell computed to the translucent primary ALONE and
// composited onto the page instead of the card, which in dark theme made the
// busiest days DARKER than the empty ones. Exactly backwards, and it is why the
// original grid had those odd navy blotches.
function densityTint(count: number): string {
  if (count === 0) return "";
  if (count <= 3) return "bg-primary/[0.03] dark:bg-primary/[0.06]";
  if (count <= 6) return "bg-primary/[0.06] dark:bg-primary/[0.10]";
  return "bg-primary/[0.10] dark:bg-primary/[0.16]";
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function parseMonth(s?: string): Date {
  if (!s) return startOfMonth(new Date());
  const d = parse(s, "yyyy-MM", new Date());
  if (Number.isNaN(d.getTime())) return startOfMonth(new Date());
  return startOfMonth(d);
}

export default async function AdminCalendar({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; vehicle?: string }>;
}) {
  await requireAnyRole(["ADMIN"]);
  const t = await getTranslations("calendar");
  const tc = await getTranslations("common");
  const localeCode = await getLocale();
  const loc: Locale = localeCode.toLowerCase().startsWith("th") ? th : enUS;
  const isThaiUi = localeCode.toLowerCase().startsWith("th");
  const qs = await searchParams;
  const monthAnchor = parseMonth(qs.month);
  const vehicleFilter = qs.vehicle && qs.vehicle !== "all" ? qs.vehicle : null;

  const gridStart = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 0 });

  // car = driver, so the filter reads better as a person. Falls back to the
  // plate for a car with nobody assigned to it.
  const driverNameOf = (v: {
    assignedDriver: { user: { name: string | null; thaiName: string | null } } | null;
  }) => {
    const u = v.assignedDriver?.user;
    if (!u) return null;
    return (isThaiUi ? u.thaiName ?? u.name : u.name ?? u.thaiName) ?? null;
  };

  const [bookings, allVehicles] = await Promise.all([
    prisma.booking.findMany({
      where: {
        // Overlap the visible grid (not start-in-day) so a multi-day trip lands
        // in every cell it spans, including ones that began before the grid.
        startAt: { lte: gridEnd },
        endAt: { gte: gridStart },
        status: { not: "DRAFT" },
        ...(vehicleFilter ? { vehicleId: vehicleFilter } : {}),
      },
      orderBy: { startAt: "asc" },
      include: {
        vehicle: { select: { registrationNumber: true } },
        requester: { select: { name: true, email: true } },
      },
    }),
    prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: { registrationNumber: "asc" },
      select: {
        id: true,
        registrationNumber: true,
        assignedDriver: { select: { user: { select: { name: true, thaiName: true } } } },
      },
    }),
  ]);

  const queryString = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (vehicleFilter) params.set("vehicle", vehicleFilter);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) params.delete(k);
      else params.set(k, v);
    }
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  // Bucket each booking into EVERY grid day it spans (not just its start day),
  // carrying the per-day projection so a cell can show ↩/↪ continuation markers.
  type DayItem = { b: (typeof bookings)[number]; span: DaySpan };
  const byDay = new Map<string, DayItem[]>();
  for (const b of bookings) {
    for (const d of daysSpanned(b.startAt, b.endAt, gridStart, gridEnd)) {
      const key = format(d, "yyyy-MM-dd");
      const span = daySpan(b.startAt, b.endAt, d, addDays(d, 1));
      const list = byDay.get(key) ?? [];
      list.push({ b, span });
      byDay.set(key, list);
    }
  }

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const prevMonth = format(subMonths(monthAnchor, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthAnchor, 1), "yyyy-MM");
  const today = new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[1.75rem] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[2rem]">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">{format(monthAnchor, "MMMM yyyy", { locale: loc })}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <form action="/admin/calendar" method="get" className="flex items-center gap-1">
            {qs.month && <input type="hidden" name="month" value={qs.month} />}
            <SelectField
              name="vehicle"
              defaultValue={vehicleFilter ?? "all"}
              className="h-11 w-44"
              aria-label={t("vehicleFilter")}
              options={[
                { value: "all", label: t("allVehicles") },
                ...allVehicles.map((v) => ({
                  value: v.id,
                  // car = driver: the dispatcher thinks in people, not plates.
                  label: driverNameOf(v) ?? v.registrationNumber,
                })),
              ]}
            />
            <button
              type="submit"
              className="h-11 rounded-lg border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
            >
              {tc("apply")}
            </button>
          </form>
          {/* One segmented control, not three floating boxes. Three separately
              bordered buttons at three different widths read as three unrelated
              actions; they are one control with three positions. h-11 matches
              the select beside them and the app's 44px touch minimum, which the
              old px-3 py-1.5 links (~34px) missed. */}
          <div className="inline-flex h-11 items-stretch overflow-hidden rounded-lg border bg-background divide-x">
            <Link
              href={`/admin/calendar${queryString({ month: prevMonth })}`}
              className="inline-flex items-center px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              ← {format(subMonths(monthAnchor, 1), "MMM", { locale: loc })}
            </Link>
            <Link
              href={`/admin/calendar${queryString({ month: undefined })}`}
              className="inline-flex items-center px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {t("thisMonth")}
            </Link>
            <Link
              href={`/admin/calendar${queryString({ month: nextMonth })}`}
              className="inline-flex items-center px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {format(addMonths(monthAnchor, 1), "MMM", { locale: loc })} →
            </Link>
          </div>
        </div>
      </div>

      {/* A legend, drawn as one. These were seven filled chips with borders —
          the exact shape the app uses for interactive filter pills — so they
          invited a click that does nothing. A dot and a label cannot be
          mistaken for a control, and it drops seven competing fills from the
          top of a page whose grid below is already carrying colour. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {CALENDAR_STATUS_LEGEND.map((key) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_STYLE[key].dot}`} aria-hidden />
            {t(`legend.${key}`)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          {t("conflictLegend")}
        </span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          {WEEKDAY_KEYS.map((k) => (
            <div key={k} className="px-3 py-2">{t(`weekdayHeaders.${k}`)}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const items = byDay.get(key) ?? [];
            const inMonth = isSameMonth(day, monthAnchor);
            const isToday = isSameDay(day, today);
            const liveCount = items.filter((it) => LIVE_STATUSES.has(it.b.status)).length;
            const conflict = conflictingBookingIds(items.map((it) => it.b)).size > 0;
            // An all-out-of-month row (a leading or trailing week) has nothing
            // in it, and at min-h-20 spent 80px saying so. Shorter out-of-month
            // cells let such a row collapse on its own, while a mixed row still
            // sizes to its tallest cell.
            const surface = inMonth
              ? "min-h-24 bg-card"
              : "min-h-14 bg-muted/40 text-muted-foreground/70 dark:bg-white/[0.02] dark:text-muted-foreground/60";
            const tint = inMonth ? densityTint(liveCount) : "";
            return (
              <div
                key={key}
                className={`relative border-t border-l p-1 ${surface}`}
              >
                {/* -z-10 keeps the wash above the cell's own background and
                    below its contents; the cell is already `relative`. */}
                {tint && (
                  <span aria-hidden className={`pointer-events-none absolute inset-0 -z-10 ${tint}`} />
                )}
                <div className="flex items-center justify-between">
                  <span
                    className={
                      isToday
                        ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold tabular-nums"
                        : "text-xs tabular-nums px-1"
                    }
                  >
                    {format(day, "d")}
                  </span>
                  <div className="flex items-center gap-1">
                    {conflict && (
                      <AlertTriangle
                        className="h-3.5 w-3.5 text-destructive"
                        aria-label={t("conflictLegend")}
                      />
                    )}
                    {items.length > 0 && (
                      <span className="rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                        {items.length}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-1 space-y-0.5">
                  {items.slice(0, 5).map(({ b, span }) => (
                    // A 2px rail rather than a filled, bordered box. Five
                    // saturated boxes stacked in one cell is a wall of colour
                    // where nothing stands out and the destination — the thing
                    // being read — competes with its own background. The rail
                    // keeps status identifiable down the left edge while the
                    // text sits on a neutral surface. Same reasoning as
                    // JobTypeChip: neutral body, colour as the accent.
                    <Link
                      key={b.id}
                      href={`/admin/${b.id}`}
                      className={`flex items-baseline gap-1.5 rounded-sm border-l-2 bg-muted/50 py-0.5 pr-1.5 pl-1.5 text-[11px] leading-tight transition-colors hover:bg-muted ${
                        STATUS_STYLE[b.status].rail
                      } ${b.status === "CANCELLED" ? "line-through opacity-70" : ""}`}
                      title={`${formatTh(b.startAt, "EEE HH:mm")}–${formatTh(b.endAt, "EEE HH:mm")} · ${b.destination}`}
                    >
                      <span className="shrink-0 font-medium tabular-nums text-foreground">
                        {cellTime(b.startAt, b.endAt, span)}
                      </span>
                      <span className="truncate text-muted-foreground">{b.destination}</span>
                    </Link>
                  ))}
                  {items.length > 5 && (
                    <Link
                      href={`/admin/calendar/day/${key}`}
                      className="block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    >
                      {t("more", { n: items.length - 5 })}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
