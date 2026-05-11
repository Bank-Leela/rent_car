import Link from "next/link";
import { format, startOfDay, endOfDay, addDays, subDays, isSameDay } from "date-fns";
import { Calendar, ChevronRight, MapPin, Coffee } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

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

  const filter = {
    OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
  };

  const [upcoming, past] = await Promise.all([
    prisma.booking.findMany({
      where: {
        ...filter,
        status: { in: ["ASSIGNED", "COMPLETED"] },
        startAt: { gte: todayStart, lte: endOfDay(addDays(now, 30)) },
      },
      orderBy: { startAt: "asc" },
      include: { vehicle: true, requester: true },
    }),
    prisma.booking.findMany({
      where: {
        ...filter,
        status: "COMPLETED",
        startAt: { gte: startOfDay(subDays(now, 14)), lt: todayStart },
      },
      orderBy: { startAt: "desc" },
      take: 30,
      include: { vehicle: true, requester: true },
    }),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader title={t("scheduleTitle")} description={t("scheduleSubtitle")} />

      <Section title={t("scheduleAllHeading")} icon={<Calendar className="h-4 w-4" />}>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title={t("scheduleEmptyTitle")}
            description={t("scheduleEmptyDescription")}
          />
        ) : (
          <DayGroupedList bookings={upcoming} now={now} />
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

type Row = Awaited<ReturnType<typeof loadRow>>;
async function loadRow() {
  return prisma.booking.findFirstOrThrow({
    include: { vehicle: true, requester: true },
  });
}

function DayGroupedList({ bookings, now, muted }: { bookings: Row[]; now: Date; muted?: boolean }) {
  // Group by yyyy-MM-dd
  const groups = new Map<string, Row[]>();
  for (const b of bookings) {
    const key = format(b.startAt, "yyyy-MM-dd");
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }
  return (
    <div className={`space-y-6 ${muted ? "opacity-80" : ""}`}>
      {Array.from(groups.entries()).map(([key, rows]) => {
        const day = rows[0].startAt;
        const isToday = isSameDay(day, now);
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

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}
