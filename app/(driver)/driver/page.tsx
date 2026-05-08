import Link from "next/link";
import { format, startOfDay, endOfDay, addDays } from "date-fns";
import { Coffee, ChevronRight, MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { EmptyState } from "@/components/empty-state";

export default async function DriverHome() {
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

  const driverFilter = {
    OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
  };

  const [today, tomorrow] = await Promise.all([
    prisma.booking.findMany({
      where: {
        ...driverFilter,
        status: { in: ["ASSIGNED", "COMPLETED"] },
        startAt: { gte: startOfDay(now), lte: endOfDay(now) },
      },
      orderBy: { startAt: "asc" },
      include: { vehicle: true, requester: true, primaryDriver: { include: { user: true } } },
    }),
    prisma.booking.findMany({
      where: {
        ...driverFilter,
        status: "ASSIGNED",
        startAt: { gte: startOfDay(addDays(now, 1)), lte: endOfDay(addDays(now, 1)) },
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
          today.map((b) => <AssignmentCard key={b.id} booking={b} />)
        )}
      </Section>

      <Section title={t("tomorrowHeading")}>
        {tomorrow.length === 0 ? (
          <EmptyState icon={Coffee} title={t("noTripsTomorrow")} description={t("noTripsTomorrowDescription")} />
        ) : (
          tomorrow.map((b) => <AssignmentCard key={b.id} booking={b} />)
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

type AssignmentRow = Awaited<ReturnType<typeof loadAssignments>>[number];
async function loadAssignments() {
  return prisma.booking.findMany({
    include: { vehicle: true, requester: true, primaryDriver: { include: { user: true } } },
  });
}

function AssignmentCard({ booking }: { booking: AssignmentRow }) {
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
          <span className="text-3xl font-semibold tabular-nums">{format(booking.startAt, "HH:mm")}</span>
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
