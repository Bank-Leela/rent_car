import Link from "next/link";
import { format, startOfDay, addDays } from "date-fns";
import { Coffee, ChevronRight, MapPin } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { isStationEmail } from "@/lib/auth/station";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { EmptyState } from "@/components/empty-state";
import { daySpan } from "@/lib/booking/day-window";

export default async function DriverHome() {
  const session = await requireRole("DRIVER");
  const t = await getTranslations("driver");

  // The shared station kiosk has no personal "today" view — send it to the schedule.
  if (isStationEmail(session.user.email)) redirect("/driver/schedule");

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

  const driverFilter = {
    OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
  };

  // Day windows (local midnights). Overlap queries below so a multi-day trip
  // shows on its return/middle days too — a driver mid-trip is still on duty.
  const todayStart = startOfDay(now);
  const todayEnd = addDays(todayStart, 1);
  const tmrStart = todayEnd;
  const tmrEnd = addDays(tmrStart, 1);

  const [today, tomorrow] = await Promise.all([
    prisma.booking.findMany({
      where: {
        ...driverFilter,
        status: { in: ["ASSIGNED", "COMPLETED"] },
        startAt: { lt: todayEnd },
        endAt: { gt: todayStart },
      },
      orderBy: { startAt: "asc" },
      include: { vehicle: true, requester: true, primaryDriver: { include: { user: true } } },
    }),
    prisma.booking.findMany({
      where: {
        ...driverFilter,
        status: "ASSIGNED",
        startAt: { lt: tmrEnd },
        endAt: { gt: tmrStart },
      },
      orderBy: { startAt: "asc" },
      include: { vehicle: true, requester: true, primaryDriver: { include: { user: true } } },
    }),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("todayHeading")}</h1>
        <p className="mt-1 text-base text-muted-foreground">{format(now, "EEEE d MMMM yyyy")}</p>
      </div>

      <Section title={t("todayHeading")}>
        {today.length === 0 ? (
          <EmptyState icon={Coffee} title={t("noTripsToday")} description={t("noTripsTodayDescription")} />
        ) : (
          today.map((b) => (
            <AssignmentCard key={b.id} booking={b} dayStart={todayStart} dayEnd={todayEnd} />
          ))
        )}
      </Section>

      <Section title={t("tomorrowHeading")}>
        {tomorrow.length === 0 ? (
          <EmptyState icon={Coffee} title={t("noTripsTomorrow")} description={t("noTripsTomorrowDescription")} />
        ) : (
          tomorrow.map((b) => (
            <AssignmentCard key={b.id} booking={b} dayStart={tmrStart} dayEnd={tmrEnd} />
          ))
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

type AssignmentRow = Prisma.BookingGetPayload<{
  include: { vehicle: true; requester: true; primaryDriver: { include: { user: true } } };
}>;

function AssignmentCard({
  booking,
  dayStart,
  dayEnd,
}: {
  booking: AssignmentRow;
  dayStart: Date;
  dayEnd: Date;
}) {
  // Multi-day trips: on the return day show "↩ <return time>", on the departure
  // day "<start> ↪", on a middle day "↪↩" (away all day) — never a misleading
  // raw prior-day start time.
  const span = daySpan(booking.startAt, booking.endAt, dayStart, dayEnd);
  const timeLabel =
    span.continuesBefore && span.continuesAfter
      ? "↪↩"
      : span.continuesBefore
        ? `↩ ${format(booking.endAt, "HH:mm")}`
        : span.continuesAfter
          ? `${format(booking.startAt, "HH:mm")} ↪`
          : format(booking.startAt, "HH:mm");
  return (
    <Link
      href={`/driver/${booking.id}`}
      className="group flex items-start justify-between gap-4 rounded-2xl border bg-card p-5 shadow-sm transition-colors hover:bg-muted/40"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{booking.jobNumber}</span>
          <BookingStatusBadge status={booking.status} />
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-3xl font-semibold tabular-nums">{timeLabel}</span>
          <span className="text-lg font-medium truncate">{booking.destination}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {booking.vehicle?.registrationNumber ?? "—"}
          </span>
          <span>{booking.passengerCount} pax</span>
          <span>
            {booking.requester.name ?? booking.requester.email}
            {booking.requester.phone ? ` · ${booking.requester.phone}` : ""}
          </span>
        </div>
      </div>
      <ChevronRight className="h-6 w-6 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
