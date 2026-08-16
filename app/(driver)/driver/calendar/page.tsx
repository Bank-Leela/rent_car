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
import { isStationEmail } from "@/lib/auth/station";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/empty-state";
import { Coffee } from "lucide-react";
import { daySpan, daysSpanned, type DaySpan } from "@/lib/booking/day-window";
import { formatTh } from "@/lib/format-date";
import { STATUS_STYLE } from "@/lib/booking/status-style";
import { localDayOfDbDate } from "@/lib/booking/db-date";

// Compact month-cell time: ↩<return> on a return day, ↪↩ when away the whole
// day, else the real start time.
function cellTime(startAt: Date, endAt: Date, span: DaySpan): string {
  if (span.continuesBefore && span.continuesAfter) return "↪↩";
  if (span.continuesBefore) return `↩${format(endAt, "HH:mm")}`;
  return format(startAt, "HH:mm");
}

// Only these three can appear — the query below pins status to them — so unlike
// the admin calendar this page was never missing a colour. It was still a third
// copy of the same table; the colours now come from the one shared source.
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
  searchParams: Promise<{ month?: string; driver?: string }>;
}) {
  const session = await requireRole("DRIVER");
  const t = await getTranslations("driverCalendar");
  const tc = await getTranslations("common");
  const tcal = await getTranslations("calendar");
  const localeCode = await getLocale();
  const loc: Locale = localeCode.toLowerCase().startsWith("th") ? th : enUS;

  // Drivers sign in on ONE shared station kiosk — there are no personal driver
  // logins — so that account has no Driver row and never will. driver/page.tsx
  // already handles it; this page did not, and showed the kiosk
  // "ไม่พบโปรไฟล์พนักงานขับรถ", i.e. the calendar tab was dead for every driver.
  // For the kiosk the whole fleet's month IS the useful view, the same way
  // /driver/schedule shows the whole day.
  const isStation = isStationEmail(session.user.email);
  const driver = isStation
    ? null
    : await prisma.driver.findUnique({ where: { userId: session.user.id } });
  if (!isStation && !driver) {
    return (
      <EmptyState
        icon={Coffee}
        title={t("noProfileTitle")}
        description={t("noProfileDescription")}
      />
    );
  }
  const driverId = driver?.id ?? null;
  const qs = await searchParams;

  // The kiosk's whole-fleet month answers "what is the fleet doing" but not
  // "what is อาคม doing" — the cells name the CAR, so picking one person's month
  // out of five cars' worth of chips meant reading the registration on every
  // chip. A personal login already sees only itself, so the picker is kiosk-only
  // and ?driver is ignored there rather than letting a URL widen what one driver
  // can see.
  const rosterForPicker = isStation
    ? await prisma.driver.findMany({
        where: { isActive: true, user: { is: { isActive: true } } },
        select: {
          id: true,
          user: { select: { name: true, thaiName: true } },
          assignedVehicle: { select: { registrationNumber: true } },
        },
      })
    : [];
  const isThai = localeCode.toLowerCase().startsWith("th");
  const pickerDrivers = rosterForPicker
    .map((d) => ({
      id: d.id,
      name: (isThai ? d.user.thaiName ?? d.user.name : d.user.name ?? d.user.thaiName) ?? d.id,
      carReg: d.assignedVehicle?.registrationNumber ?? null,
    }))
    // Same order as the admin board's roster: by car, so the picker and the
    // board list the fleet the same way round.
    .sort((a, b) => (a.carReg ?? "~").localeCompare(b.carReg ?? "~") || a.name.localeCompare(b.name));

  // Unknown or non-roster ids fall back to the whole fleet rather than silently
  // rendering an empty month that looks like "this driver has no work".
  const picked = isStation && qs.driver ? pickerDrivers.find((d) => d.id === qs.driver) ?? null : null;
  // What the queries below key on: the driver's own id on a personal login, the
  // picked one on the kiosk, null for the whole fleet.
  const focusDriverId = driverId ?? picked?.id ?? null;

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
      // One driver's trips — their own on a personal login, the picked one on the
      // kiosk. With nobody picked the kiosk shows every driver's.
      ...(focusDriverId
        ? {
            OR: [
              { primaryDriverId: focusDriverId },
              { secondaryDriverId: focusDriverId },
              { claims: { some: { driverId: focusDriverId, status: "ACTIVE" } } },
            ],
          }
        : { primaryDriverId: { not: null } }),
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
  // On the kiosk every day has SOME duty driver, so tinting them all says
  // nothing — the เวร marking is only meaningful for one person's own calendar.
  // Picking a driver makes it exactly that, so the tint comes back for them:
  // "which days am I on เวร" is most of why you would filter to one person.
  const dutyShifts = focusDriverId
    ? await prisma.onCallShift.findMany({
        where: { driverId: focusDriverId, date: { gte: gridStart, lte: gridEnd } },
        select: { date: true },
      })
    : [];
  // localDayOfDbDate, and this is the third attempt at this line — so, precisely:
  // writing local midnight of day D into an @db.Date column stores D−1 (a local
  // Monday goes in as the Sunday, measured: 2027-03-01 local → "2027-02-28"), and
  // reading it back returns that stored day. dbDateKey() of the read-back value
  // therefore names D−1, which is right only when it is compared against another
  // equally-shifted key — as duty-roster.ts and queue-context.ts do. Here it was
  // compared against format(day, "yyyy-MM-dd") of a real local day, so the เวร
  // tint landed one cell EARLY: a Monday duty painted the Sunday, which is how a
  // weekday-only roster still showed เวร on Saturdays and Sundays.
  //
  // localDayOfDbDate() undoes the shift and hands back the local day the shift is
  // actually about, so both sides of the comparison are local days.
  const dutyDays = new Set(dutyShifts.map((s) => format(localDayOfDbDate(s.date), "yyyy-MM-dd")));

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const prevMonth = format(subMonths(monthAnchor, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthAnchor, 1), "yyyy-MM");
  const today = new Date();

  // The two axes are independent: changing month must keep the driver, and
  // changing driver must keep the month, or every click resets the other.
  const hrefFor = (opts: { month?: string | null; driver?: string | null }) => {
    const p = new URLSearchParams();
    const month = opts.month === undefined ? qs.month : opts.month;
    const drv = opts.driver === undefined ? picked?.id ?? null : opts.driver;
    if (month) p.set("month", month);
    if (drv) p.set("driver", drv);
    const s = p.toString();
    return s ? `/driver/calendar?${s}` : "/driver/calendar";
  };
  // h-11, was py-1.5 (~34px). Every other surface got the 44px minimum and this
  // one needed it most: the comment below says out loud that this is a shared
  // touch screen, and these were the smallest touch targets in the app.
  const chip = (active: boolean) =>
    `inline-flex h-11 items-center rounded-lg border px-3 text-sm transition-colors ${
      active ? "border-primary bg-primary/10 font-medium text-foreground" : "bg-background hover:bg-muted"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          {/* The kiosk is shared, so "ของฉัน" would be a lie — it shows every car.
              With a driver picked their name IS the title: the grid no longer
              shows the fleet, and a heading still saying "ปฏิทินรถทั้งหมด" over
              one person's month would be the same lie in the other direction. */}
          <h1 className="text-2xl font-semibold tracking-tight">
            {isStation ? picked?.name ?? t("titleStation") : t("title")}
          </h1>
          <p className="text-muted-foreground">{format(monthAnchor, "MMMM yyyy", { locale: loc })}</p>
        </div>
        {/* One segmented control, matching the admin calendar. */}
        <div className="inline-flex h-11 items-stretch divide-x overflow-hidden rounded-lg border bg-background">
          <Link
            href={hrefFor({ month: prevMonth })}
            className="inline-flex items-center px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            ← {format(subMonths(monthAnchor, 1), "MMM", { locale: loc })}
          </Link>
          {/* month:null, not a bare /driver/calendar — that dropped the picked
              driver, so "this month" silently widened the view back to the fleet. */}
          <Link
            href={hrefFor({ month: null })}
            className="inline-flex items-center px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {tcal("thisMonth")}
          </Link>
          <Link
            href={hrefFor({ month: nextMonth })}
            className="inline-flex items-center px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {format(addMonths(monthAnchor, 1), "MMM", { locale: loc })} →
          </Link>
        </div>
      </div>

      {/* Kiosk only. Links, not a <select>: this is a shared touch screen, so a
          row of targets beats a dropdown that needs two taps and a steady hand,
          and it keeps the page a server component. Each label carries the car
          because the cells are labelled by car — car = driver, so the picker is
          also how you read which registration belongs to whom. */}
      {isStation && pickerDrivers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("filterLabel")}</span>
          <Link href={hrefFor({ driver: null })} className={chip(!picked)}>
            {t("filterAll")}
          </Link>
          {pickerDrivers.map((d) => (
            <Link key={d.id} href={hrefFor({ driver: d.id })} className={chip(picked?.id === d.id)}>
              {d.name}
              {d.carReg && (
                <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{d.carReg}</span>
              )}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {LEGEND_KEYS.map((key) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_STYLE[key].dot}`} aria-hidden />
            {tcal(`legend.${key}`)}
          </span>
        ))}
        {/* A filled square, not a dot: เวร is a property of the whole DAY and is
            drawn as a wash across the cell, while the dots above are trips
            inside it. Both are emerald — ASSIGNED and on-duty genuinely are the
            same green in this app — so the shapes have to carry the difference. */}
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm bg-emerald-500/20 ring-1 ring-emerald-500/50"
            aria-hidden
          />
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
            // เวร used to be a 2px emerald left border on the cell. The trip rows
            // inside it are now 2px coloured left borders too — and ASSIGNED is
            // emerald — so the day marker and a row marker would have been the
            // same mark in the same colour at the same edge. A wash over the
            // whole cell says "this day" instead of "this row", which is what it
            // actually means.
            const surface = inMonth
              ? "min-h-24 bg-card"
              : "min-h-14 bg-muted/40 text-muted-foreground/70 dark:bg-white/[0.02] dark:text-muted-foreground/60";
            return (
              <div key={key} className={`relative border-t border-l p-1 ${surface}`}>
                {/* An overlay rather than a background on the cell: this and
                    bg-card both set background-color, so on one element they do
                    not layer — the wash simply replaced the card surface and the
                    เวร day composited onto the page instead. -z-10 puts it above
                    the cell background and below its contents. */}
                {inMonth && isDuty && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -z-10 bg-emerald-500/[0.07] dark:bg-emerald-500/[0.10]"
                  />
                )}
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
                      className={`block rounded-sm border-l-2 bg-muted/50 px-1.5 py-0.5 text-[11px] leading-tight transition-colors hover:bg-muted ${
                        STATUS_STYLE[b.status].rail
                      }`}
                      title={`${formatTh(b.startAt, "EEE HH:mm")}–${formatTh(b.endAt, "EEE HH:mm")} · ${b.destination}`}
                    >
                      <div className="truncate font-medium tabular-nums text-foreground">
                        {cellTime(b.startAt, b.endAt, span)} {b.vehicle?.registrationNumber ?? "—"}
                      </div>
                      <div className="truncate text-muted-foreground">{b.destination}</div>
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
