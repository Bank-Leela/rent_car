import { notFound } from "next/navigation";
import Link from "next/link";
import { format, parse, startOfDay, addDays } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { conflictingBookingIds } from "@/lib/booking/calendar-conflicts";
import { daySpan, type DaySpan } from "@/lib/booking/day-window";
import type { Prisma } from "@prisma/client";

const BAR_COLOR: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-200 border-amber-400 text-amber-950 dark:bg-amber-500/30 dark:text-amber-100 dark:border-amber-400/40",
  APPROVED: "bg-blue-200 border-blue-400 text-blue-950 dark:bg-blue-500/30 dark:text-blue-100 dark:border-blue-400/40",
  ASSIGNED: "bg-emerald-200 border-emerald-400 text-emerald-950 dark:bg-emerald-500/30 dark:text-emerald-100 dark:border-emerald-400/40",
  COMPLETED: "bg-violet-200 border-violet-300 text-violet-950 dark:bg-violet-500/25 dark:text-violet-100 dark:border-violet-400/30",
  CANCELLED: "bg-muted border-border text-muted-foreground line-through",
  DENIED: "bg-rose-200 border-rose-400 text-rose-950 dark:bg-rose-500/30 dark:text-rose-100 dark:border-rose-400/40",
};

type View = "agenda" | "timeline";

export default async function CalendarDay({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  await requireRole("ADMIN");
  const t = await getTranslations("calendarDay");
  const { date } = await params;
  const { view: viewParam } = await searchParams;
  const view: View = viewParam === "timeline" ? "timeline" : "agenda";

  const day = parse(date, "yyyy-MM-dd", new Date());
  if (Number.isNaN(day.getTime())) notFound();
  const dayStart = startOfDay(day);
  const dayEnd = startOfDay(addDays(day, 1));

  const bookings = await prisma.booking.findMany({
    where: {
      // Overlap, not start-in-day: a multi-day trip must appear on every day it
      // spans (return/middle days too), not only its departure day.
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
      status: { not: "DRAFT" },
    },
    orderBy: { startAt: "asc" },
    include: {
      vehicle: { select: { registrationNumber: true } },
      requester: { select: { name: true, email: true } },
      department: { select: { nameEn: true } },
      primaryDriver: { include: { user: { select: { name: true, email: true } } } },
    },
  });

  const conflicts = conflictingBookingIds(bookings);
  const monthHref = `/admin/calendar?month=${format(day, "yyyy-MM")}`;
  const toggle = (v: View) =>
    `/admin/calendar/day/${date}${v === "timeline" ? "?view=timeline" : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {format(day, "EEEE d MMMM yyyy")}
          </h1>
          <p className="text-muted-foreground">{t("bookingCount", { count: bookings.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* view toggle */}
          <div className="inline-flex rounded-md border bg-background p-0.5 text-sm" role="group">
            <Link
              href={toggle("agenda")}
              aria-current={view === "agenda" ? "true" : undefined}
              className={`rounded px-3 py-1 transition-colors ${
                view === "agenda" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {t("viewAgenda")}
            </Link>
            <Link
              href={toggle("timeline")}
              aria-current={view === "timeline" ? "true" : undefined}
              className={`rounded px-3 py-1 transition-colors ${
                view === "timeline" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {t("viewTimeline")}
            </Link>
          </div>
          <Link
            href={monthHref}
            className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            {t("backToMonth")}
          </Link>
        </div>
      </div>

      {bookings.length === 0 ? (
        <p className="rounded-md border bg-card py-8 text-center text-sm text-muted-foreground">
          {t("nothingScheduled")}
        </p>
      ) : view === "timeline" ? (
        <TimelineView day={day} dayStart={dayStart} dayEnd={dayEnd} bookings={bookings} conflicts={conflicts} t={t} />
      ) : (
        <AgendaView dayStart={dayStart} dayEnd={dayEnd} bookings={bookings} conflicts={conflicts} t={t} />
      )}
    </div>
  );
}

type Booking = Prisma.BookingGetPayload<{
  include: {
    vehicle: { select: { registrationNumber: true } };
    requester: { select: { name: true; email: true } };
    department: { select: { nameEn: true } };
    primaryDriver: { include: { user: { select: { name: true; email: true } } } };
  };
}>;

type Translator = Awaited<ReturnType<typeof getTranslations<"calendarDay">>>;

// Agenda time column: a normal trip shows its range; a trip continuing across
// the viewed day shows ↩ <return> (return day), <start> ↪ (departure day), or
// ↪↩ (away the whole day) — never a misleading raw prior/next-day time.
function agendaTime(b: Booking, span: DaySpan): string {
  if (span.continuesBefore && span.continuesAfter) return "↪↩";
  if (span.continuesBefore) return `↩ ${format(b.endAt, "HH:mm")}`;
  if (span.continuesAfter) return `${format(b.startAt, "HH:mm")} ↪`;
  return `${format(b.startAt, "HH:mm")}–${format(b.endAt, "HH:mm")}`;
}

/* ----------------------------- Agenda view ----------------------------- */

function AgendaRow({
  b,
  span,
  conflict,
  t,
}: {
  b: Booking;
  span: DaySpan;
  conflict: boolean;
  t: Translator;
}) {
  return (
    <Link
      href={`/admin/${b.id}`}
      className="flex min-h-11 items-center gap-3 rounded-lg border bg-card px-3 py-2 hover:bg-muted/40"
    >
      <time className="w-[5.5rem] shrink-0 text-sm font-medium tabular-nums">
        {agendaTime(b, span)}
      </time>
      <BookingStatusBadge status={b.status} />
      <span className="font-mono text-xs text-muted-foreground shrink-0 hidden sm:inline">
        {b.jobNumber}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.purpose}</span>
      <span className="hidden min-w-0 max-w-[14rem] truncate text-sm text-muted-foreground md:inline">
        {b.destination}
      </span>
      <span className="hidden shrink-0 font-mono text-xs text-muted-foreground lg:inline">
        {b.vehicle?.registrationNumber ?? "—"}
      </span>
      {conflict && (
        <AlertTriangle
          className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
          aria-label={t("conflict")}
        />
      )}
    </Link>
  );
}

function AgendaView({
  dayStart,
  dayEnd,
  bookings,
  conflicts,
  t,
}: {
  dayStart: Date;
  dayEnd: Date;
  bookings: Booking[];
  conflicts: Set<string>;
  t: Translator;
}) {
  // Bucket by the trip's start clamped to this day: a trip continuing from a
  // prior day sorts into the morning (it's already underway at 00:00).
  const withSpan = bookings.map((b) => ({ b, span: daySpan(b.startAt, b.endAt, dayStart, dayEnd) }));
  const morning = withSpan.filter(({ span }) => span.startHour < 12);
  const afternoon = withSpan.filter(({ span }) => span.startHour >= 12);

  return (
    <div className="space-y-5">
      {[
        { label: t("morning"), items: morning },
        { label: t("afternoon"), items: afternoon },
      ]
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.label} className="space-y-1.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {g.label}
            </h2>
            <div className="space-y-1.5">
              {g.items.map(({ b, span }) => (
                <AgendaRow key={b.id} b={b} span={span} conflict={conflicts.has(b.id)} t={t} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

/* ---------------------------- Timeline view ---------------------------- */

function TimelineView({
  day,
  dayStart,
  dayEnd,
  bookings,
  conflicts,
  t,
}: {
  day: Date;
  dayStart: Date;
  dayEnd: Date;
  bookings: Booking[];
  conflicts: Set<string>;
  t: Translator;
}) {
  const dayStartMs = startOfDay(day).getTime();
  const toMin = (d: Date) =>
    Math.max(0, Math.min(1440, Math.round((d.getTime() - dayStartMs) / 60000)));

  const starts = bookings.map((b) => toMin(b.startAt));
  const ends = bookings.map((b) => toMin(b.endAt));
  const winStart = Math.floor(Math.min(...starts) / 60) * 60;
  let winEnd = Math.ceil(Math.max(...ends) / 60) * 60;
  if (winEnd <= winStart) winEnd = winStart + 60;
  const span = winEnd - winStart;
  const pct = (m: number) => ((m - winStart) / span) * 100;

  const hours: number[] = [];
  for (let h = winStart / 60; h <= winEnd / 60; h++) hours.push(h);

  // group by vehicle (unassigned last)
  const groups = new Map<string, { label: string; items: Booking[] }>();
  for (const b of bookings) {
    const k = b.vehicleId ?? "__none";
    if (!groups.has(k)) {
      groups.set(k, { label: b.vehicle?.registrationNumber ?? t("unassigned"), items: [] });
    }
    groups.get(k)!.items.push(b);
  }
  const rows = [...groups.entries()].sort(([ka, a], [kb, bb]) => {
    if (ka === "__none") return 1;
    if (kb === "__none") return -1;
    return a.label.localeCompare(bb.label);
  });

  const LANE_H = 26; // px per lane

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div className="min-w-[680px]">
        {/* hour header */}
        <div className="flex border-b bg-muted/40 text-[10px] text-muted-foreground">
          <div className="w-24 shrink-0 px-2 py-1 font-medium">{t("vehicleColumn")}</div>
          <div className="relative h-6 flex-1">
            {hours.map((h) => (
              <span
                key={h}
                className="absolute top-1 -translate-x-1/2 tabular-nums"
                style={{ left: `${pct(h * 60)}%` }}
              >
                {String(h).padStart(2, "0")}
              </span>
            ))}
          </div>
        </div>

        {/* rows */}
        {rows.map(([key, row]) => {
          // lane packing
          const sorted = [...row.items].sort(
            (a, b) => a.startAt.getTime() - b.startAt.getTime(),
          );
          const laneEnds: number[] = [];
          const placed = sorted.map((b) => {
            const s = toMin(b.startAt);
            const e = toMin(b.endAt);
            let lane = laneEnds.findIndex((end) => end <= s);
            if (lane === -1) {
              laneEnds.push(e);
              lane = laneEnds.length - 1;
            } else {
              laneEnds[lane] = e;
            }
            return { b, s, e, lane };
          });
          const rowH = Math.max(1, laneEnds.length) * LANE_H + 8;

          return (
            <div key={key} className="flex border-t">
              <div className="flex w-24 shrink-0 items-center px-2 py-1 font-mono text-xs">
                {row.label}
              </div>
              <div className="relative flex-1" style={{ height: rowH }}>
                {/* hour gridlines */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 bottom-0 w-px bg-border/50"
                    style={{ left: `${pct(h * 60)}%` }}
                    aria-hidden
                  />
                ))}
                {placed.map(({ b, s, e, lane }) => {
                  const conflict = conflicts.has(b.id);
                  const span = daySpan(b.startAt, b.endAt, dayStart, dayEnd);
                  // Bar label: ↪ when it began earlier (real time is off this day);
                  // otherwise the start time. A flush left edge already signals it.
                  const barTime = span.continuesBefore ? "↪" : format(b.startAt, "HH:mm");
                  return (
                    <Link
                      key={b.id}
                      href={`/admin/${b.id}`}
                      title={`${b.jobNumber} · ${format(b.startAt, "EEE HH:mm")}–${format(
                        b.endAt,
                        "EEE HH:mm",
                      )} · ${b.purpose} · ${b.destination}`}
                      className={`absolute flex items-center gap-1 overflow-hidden rounded border px-1.5 text-[11px] leading-none hover:opacity-90 ${
                        BAR_COLOR[b.status] ?? "bg-muted border-border"
                      } ${conflict ? "ring-2 ring-rose-500" : ""} ${
                        span.continuesBefore ? "rounded-l-none border-l-2 border-l-foreground/50" : ""
                      } ${span.continuesAfter ? "rounded-r-none border-r-2 border-r-foreground/50" : ""}`}
                      style={{
                        left: `${pct(s)}%`,
                        width: `max(2.5rem, ${pct(e) - pct(s)}%)`,
                        top: lane * LANE_H + 4,
                        height: LANE_H - 4,
                      }}
                    >
                      {conflict && <AlertTriangle className="h-3 w-3 shrink-0" aria-label={t("conflict")} />}
                      <span className="truncate tabular-nums">
                        {barTime} {b.purpose}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
