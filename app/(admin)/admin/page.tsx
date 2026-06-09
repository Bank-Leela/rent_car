import Link from "next/link";
import { format, startOfDay } from "date-fns";
import { ClipboardCheck, ListOrdered, CalendarClock, ChevronRight, UserCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { OnCallShiftForm } from "@/components/forms/matching-form";

export default async function AdminQueue() {
  const session = await requireAnyRole(["ADMIN", "APPROVER"]);
  const isAdmin = session.user.roles.includes("ADMIN");
  const t = await getTranslations("admin");
  const tAuto = await getTranslations("matching");
  const today = startOfDay(new Date());

  // Shared console for ADMIN + APPROVER. Both see the full pipeline; the
  // detail page surfaces role-appropriate action forms.
  const [pending, approved, upcoming, todayShift, allDrivers] = await Promise.all([
    prisma.booking.findMany({
      // P'Top's decision queue: normal pending plus over-capacity WAITLIST
      // cases (the 11th+ booking of a day) for him to fit or deny.
      where: { status: { in: ["PENDING_APPROVAL", "WAITLIST"] } },
      orderBy: { startAt: "asc" },
      include: { requester: true, department: true },
    }),
    prisma.booking.findMany({
      where: { status: "APPROVED" },
      orderBy: { createdAt: "asc" },
      include: { requester: true, department: true },
    }),
    prisma.booking.findMany({
      where: { status: "ASSIGNED", endAt: { gte: new Date() } },
      orderBy: { startAt: "asc" },
      take: 20,
      include: { vehicle: true, primaryDriver: { include: { user: true } } },
    }),
    prisma.onCallShift.findUnique({
      where: { date: today },
      include: { driver: { include: { user: true } } },
    }),
    prisma.driver.findMany({
      where: { isActive: true },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const driversForPicker = allDrivers.map((d) => ({
    id: d.id,
    name: d.user.name ?? d.user.email ?? d.id,
  }));
  const todayIso = format(today, "yyyy-MM-dd");
  const todayOnCallName =
    todayShift?.driver.user.name ?? todayShift?.driver.user.email ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("description", { count: approved.length })}
      />

      {isAdmin && (
        <Section title={tAuto("onCallSectionHeading")} icon={<UserCheck className="h-4 w-4" />}>
          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
            <p className="text-sm text-muted-foreground">
              {todayOnCallName
                ? tAuto("todayIs", { name: todayOnCallName, date: todayIso })
                : tAuto("notSetForToday", { date: todayIso })}
            </p>
            <OnCallShiftForm
              date={todayIso}
              defaultDriverId={todayShift?.driverId ?? null}
              drivers={driversForPicker}
            />
          </div>
        </Section>
      )}

      <Section title={t("pendingHeading")} icon={<ClipboardCheck className="h-4 w-4" />}>
        {pending.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={t("pendingEmptyTitle")}
            description={t("pendingEmptyDescription")}
          />
        ) : (
          <ul className="space-y-2">
            {pending.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/admin/${b.id}`}
                  className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                      <BookingStatusBadge status={b.status} />
                    </div>
                    <div className="mt-1 font-medium truncate">{b.purpose}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM HH:mm")} → {format(b.endAt, "EEE d MMM HH:mm")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {b.requester.name ?? b.requester.email} · {b.department.nameEn}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("queueLogHeading")} icon={<ListOrdered className="h-4 w-4" />}>
        {approved.length === 0 ? (
          <EmptyState
            icon={ListOrdered}
            title={t("queueEmptyTitle")}
            description={t("queueEmptyDescription")}
          />
        ) : (
          <ol className="space-y-2">
            {approved.map((b, i) => (
              <li key={b.id}>
                <Link
                  href={`/admin/${b.id}`}
                  className="group flex items-start gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-mono text-muted-foreground"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                      <BookingStatusBadge status={b.status} />
                    </div>
                    <div className="mt-1 font-medium truncate">{b.purpose}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM HH:mm")} → {format(b.endAt, "EEE d MMM HH:mm")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {b.requester.name ?? b.requester.email} · {b.department.nameEn} ·{" "}
                      {t("submittedAt", { date: format(b.createdAt, "d MMM HH:mm") })}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={t("upcomingTrips")} icon={<CalendarClock className="h-4 w-4" />}>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={t("upcomingEmptyTitle")}
            description={t("upcomingEmptyDescription")}
          />
        ) : (
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/admin/${b.id}`}
                  className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                      <BookingStatusBadge status={b.status} />
                    </div>
                    <div className="mt-1 font-medium truncate">{b.purpose}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {format(b.startAt, "EEE d MMM HH:mm")} ·{" "}
                      {b.vehicle?.registrationNumber ?? "—"} ·{" "}
                      {b.primaryDriver?.user.name ?? b.primaryDriver?.user.email ?? "—"}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
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
