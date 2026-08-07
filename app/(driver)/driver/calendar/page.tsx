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
import { th, enUS, type Locale } from "date-fns/locale";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/empty-state";
import { Coffee } from "lucide-react";
import { daySpan, daysSpanned, type DaySpan } from "@/lib/booking/day-window";
import { formatTh } from "@/lib/format-date";

// Compact month-cell time: ↩<return> on a return day, ↪↩ when away the whole
// day, else the real start time.
function cellTime(startAt: Date, endAt: Date, span: DaySpan): string {
  if (span.continuesBefore && span.continuesAfter) return "↪↩";
  if (span.continuesBefore) return `↩${format(endAt, "HH:mm")}`;
  return format(startAt, "HH:mm");
}

const STATUS_TINT: Record<string, string> = {
  APPROVED:
    "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-400/30",
  ASSIGNED:
    "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30",
  COMPLETED:
    "bg-muted text-muted-foreground border-border dark:bg-violet-500/10 dark:text-violet-200 dark:border-violet-400/25",
};

const LEGEND_KEYS = ["APPROVED", "ASSIGNED", "COMPLETED"] as const;
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function parseMonth(s?: string): Date {
  if (!s) return startOfMonth(new Date());
  const d = parse(s, "yyyy-MM", new Date());
  if (Number.isNaN(d.getTime())) return startOfMonth(new Date());
  return startOfMonth(d);
}

export default async function DriverCalendar({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requireRole("DRIVER");
  const t = await getTranslations("driverCalendar");
  const tc = await getTranslations("common");
  const tcal = await getTranslations("calendar");
  const localeCode = await getLocale();
  const loc: Locale = localeCode.toLowerCase().startsWith("th") ? th : enUS;

  const driver = await prisma.driver.findUnique({ where: { userId: session.user.id } });
  if (!driver) {
    return (
      <EmptyState
        icon={Coffee}
        title={t("noProfileTitle")}
        description={t("noProfileDescription")}
      />
    );
  }
  const driverId = driver.id;
  const qs = await searchParams;
  const monthAnchor = parseMonth(qs.month);
  const gridStart = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 0 });

  // Trips the driver is on the hook for: assigned/completed via the
  // denormalized fields, plus active claims while still APPROVED.
  const bookings = await prisma.booking.findMany({
    where: {
      // Overlap the visible grid so a multi-day trip lands in every cell it spans.
      startAt: { lte: gridEnd },
      endAt: { gte: gridStart },
      OR: [
        { primaryDriverId: driverId },
        { secondaryDriverId: driverId },
        { claims: { some: { driverId, status: "ACTIVE" } } },
      ],
      status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
    },
    orderBy: { startAt: "asc" },
    include: { vehicle: { select: { registrationNumber: true } } },
  });

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

  // Duty (on-call / WERN) days from the OnCallShift roster the admin sets. These
  // aren't bookings, so without this the driver couldn't see when they're on call
  // — that's the calendar↔admin-schedule sync gap (the duty driver is excluded
  // from auto-assignment, so their calendar would otherwise look empty).
  const dutyShifts = await prisma.onCallShift.findMany({
    where: { driverId, date: { gte: gridStart, lte: gridEnd } },
    select: { date: true },
  });
  const dutyDays = new Set(dutyShifts.map((s) => format(s.date, "yyyy-MM-dd")));

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const prevMonth = format(subMonths(monthAnchor, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthAnchor, 1), "yyyy-MM");
  const today = new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{format(monthAnchor, "MMMM yyyy", { locale: loc })}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/driver/calendar?month=${prevMonth}`}
            className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            ← {format(subMonths(monthAnchor, 1), "MMM", { locale: loc })}
          </Link>
          <Link
            href="/driver/calendar"
            className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            {tcal("thisMonth")}
          </Link>
          <Link
            href={`/driver/calendar?month=${nextMonth}`}
            className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            {format(addMonths(monthAnchor, 1), "MMM", { locale: loc })} →
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {LEGEND_KEYS.map((key) => (
          <span key={key} className={`rounded border px-1.5 py-0.5 ${STATUS_TINT[key]}`}>
            {tcal(`legend.${key}`)}
          </span>
        ))}
        <span className="rounded border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-200">
          {t("onCallLegend")}
        </span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          {WEEKDAY_KEYS.map((k) => (
            <div key={k} className="px-3 py-2">{tcal(`weekdayHeaders.${k}`)}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const items = byDay.get(key) ?? [];
            const inMonth = isSameMonth(day, monthAnchor);
            const isToday = isSameDay(day, today);
            const isDuty = dutyDays.has(key);
            const surface = inMonth
              ? "bg-card"
              : "bg-muted/40 text-muted-foreground/70 dark:bg-white/[0.02] dark:text-muted-foreground/60";
            return (
              <div
                key={key}
                className={`relative min-h-20 border-t border-l p-1 ${surface} ${
                  isDuty ? "border-l-2 border-l-emerald-400 dark:border-l-emerald-600" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-1">
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
                    {isDuty && (
                      <span className="rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
                        {t("onCall")}
                      </span>
                    )}
                    {items.length > 0 && (
                      <span className="rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                        {items.length}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-1 space-y-1">
                  {items.slice(0, 3).map(({ b, span }) => (
                    <Link
                      key={b.id}
                      href={`/driver/${b.id}`}
                      className={`block rounded border px-1.5 py-0.5 text-[11px] leading-tight hover:opacity-80 ${
                        STATUS_TINT[b.status] ?? ""
                      }`}
                      title={`${b.jobNumber} · ${formatTh(b.startAt, "EEE HH:mm")}–${formatTh(b.endAt, "EEE HH:mm")} · ${b.destination}`}
                    >
                      <div className="font-medium truncate">
                        {cellTime(b.startAt, b.endAt, span)} {b.vehicle?.registrationNumber ?? "—"}
                      </div>
                      <div className="truncate opacity-80">{b.destination}</div>
                    </Link>
                  ))}
                  {items.length > 3 && (
                    <span className="block text-[10px] text-muted-foreground">
                      {tcal("more", { n: items.length - 3 })}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{tc("today")}: {format(today, "EEE d MMM yyyy", { locale: loc })}</p>
    </div>
  );
}
