import Link from "next/link";
import { format, startOfDay, endOfDay, addDays, subDays, isSameDay } from "date-fns";
import { Calendar, ChevronRight, MapPin, Coffee, Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";

export default async function DriverSchedule() {
  const session = await requireRole("DRIVER");
  const t = await getTranslations("driver");

  const driverProfile = await prisma.driver.findUnique({ where: { userId: session.user.id } });
  if (!driverProfile) {
    return (
      <EmptyState
        icon={Coffee}
        title={t("noProfileTitle")}
        description={t("noProfileDescription")}
      />
    );
  }
  const driverId = driverProfile.id;
  const now = new Date();
  const todayStart = startOfDay(now);

  // Match the driver calendar: a trip the driver is on the hook for via the
  // denormalized fields OR an active claim — incl. board-claimed (APPROVED) trips.
  const onHook = {
    OR: [
      { primaryDriverId: driverId },
      { secondaryDriverId: driverId },
      { claims: { some: { driverId, status: "ACTIVE" as const } } },
    ],
  };

  const horizon = endOfDay(addDays(now, 30));
  const [upcoming, past, dutyShifts] = await Promise.all([
    prisma.booking.findMany({
      where: {
        ...onHook,
        status: { in: COMMITTED_STATUSES },
        startAt: { gte: todayStart, lte: horizon },
      },
      orderBy: { startAt: "asc" },
      include: { vehicle: true, requester: true },
    }),
    prisma.booking.findMany({
      where: {
        OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
        status: "COMPLETED",
        startAt: { gte: startOfDay(subDays(now, 14)), lt: todayStart },
      },
      orderBy: { startAt: "desc" },
      take: 30,
      include: { vehicle: true, requester: true },
    }),
    // On-call (duty) days the admin rostered — these aren't bookings, so without
    // them the duty driver's schedule looks empty. Syncs with the admin roster.
    prisma.onCallShift.findMany({
      where: { driverId, date: { gte: todayStart, lte: horizon } },
      select: { date: true },
      orderBy: { date: "asc" },
    }),
  ]);
  const dutyDays = new Set(dutyShifts.map((s) => format(s.date, "yyyy-MM-dd")));

  return (
    <div className="space-y-8">
      <PageHeader title={t("scheduleTitle")} description={t("scheduleSubtitle")} />

      <Section title={t("scheduleAllHeading")} icon={<Calendar className="h-4 w-4" />}>
        {upcoming.length === 0 && dutyDays.size === 0 ? (
          <EmptyState
            icon={Calendar}
            title={t("scheduleEmptyTitle")}
            description={t("scheduleEmptyDescription")}
          />
        ) : (
          <DayGroupedList
            bookings={upcoming}
            now={now}
            dutyDays={dutyDays}
            onCallLabel={t("onCall")}
            onCallNote={t("onCallNote")}
          />
        )}
      </Section>

      {past.length > 0 && (
        <Section title={t("scheduleHistoryHeading")} icon={<Calendar className="h-4 w-4" />}>
          <DayGroupedList bookings={past} now={now} muted />
        </Section>
      )}
    </div>
  );
}

type Row = Prisma.BookingGetPayload<{ include: { vehicle: true; requester: true } }>;

function DayGroupedList({
  bookings,
  now,
  muted,
  dutyDays,
  onCallLabel,
  onCallNote,
}: {
  bookings: Row[];
  now: Date;
  muted?: boolean;
  dutyDays?: Set<string>;
  onCallLabel?: string;
  onCallNote?: string;
}) {
  // Group by yyyy-MM-dd
  const groups = new Map<string, Row[]>();
  for (const b of bookings) {
    const key = format(b.startAt, "yyyy-MM-dd");
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }
  // Render every day that has a trip OR an on-call duty (a duty-only day still
  // shows, so the duty driver's schedule isn't empty).
  const keys = [...new Set([...groups.keys(), ...(dutyDays ?? [])])].sort();
  return (
    <div className={`space-y-6 ${muted ? "opacity-80" : ""}`}>
      {keys.map((key) => {
        const rows = groups.get(key) ?? [];
        const day = rows[0]?.startAt ?? new Date(`${key}T00:00:00`);
        const isToday = isSameDay(day, now);
        const isDuty = dutyDays?.has(key) ?? false;
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">{format(day, "EEEE d MMM yyyy")}</h3>
              {isToday && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary-foreground">
                  ●
                </span>
              )}
            </div>
            <ul className="space-y-2">
              {isDuty && (
                <li>
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-400/30 dark:bg-emerald-950/30">
                    <Clock className="h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
                    <div className="min-w-0">
                      <div className="font-medium text-emerald-900 dark:text-emerald-200">{onCallLabel}</div>
                      <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80">{onCallNote}</div>
                    </div>
                  </div>
                </li>
              )}
              {rows.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/driver/${b.id}`}
                    className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                        <BookingStatusBadge status={b.status} />
                      </div>
                      <div className="mt-1 flex items-baseline gap-3">
                        <span className="text-xl font-semibold tabular-nums">
                          {format(b.startAt, "HH:mm")}
                        </span>
                        <span className="text-base font-medium truncate">{b.destination}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {b.vehicle?.registrationNumber ?? "—"}
                        </span>
                        <span>{b.passengerCount} pax</span>
                        <span>
                          {b.requester.name ?? b.requester.email}
                          {b.requester.phone ? ` · ${b.requester.phone}` : ""}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
