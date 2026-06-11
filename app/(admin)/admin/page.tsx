import Link from "next/link";
import { format, startOfDay } from "date-fns";
import { ClipboardCheck, ListOrdered, CalendarClock, ChevronRight, UserCheck, Zap } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { OnCallShiftForm } from "@/components/forms/matching-form";
import { loadWeightedEarnings } from "@/lib/booking/earnings";
import { recommendOvertimePlacement } from "@/lib/booking/overtime-reco";
import type { SlotInput } from "@/lib/booking/slot-allocation";

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

  // Overtime placement recommendations for over-capacity WAITLIST bookings:
  // an early/evening OT that the time-blind day-cap waitlisted can still fit a
  // driver who's free at that hour. Surface who/what is free so P'Top can place it.
  const overtimeReco = new Map<string, { name: string; reg: string; time: string }>();
  const waitlist = pending.filter((b) => b.status === "WAITLIST");
  if (waitlist.length > 0) {
    const dayStartMs = [...new Set(waitlist.map((b) => startOfDay(b.startAt).getTime()))];
    const rangeStart = new Date(Math.min(...dayStartMs));
    const rangeEnd = new Date(Math.max(...dayStartMs));
    rangeEnd.setDate(rangeEnd.getDate() + 1);

    const [vehicles, dayBookings, shifts, earnings] = await Promise.all([
      prisma.vehicle.findMany({
        where: { isActive: true },
        select: { id: true, registrationNumber: true, isDutyVehicle: true },
      }),
      prisma.booking.findMany({
        where: { startAt: { lt: rangeEnd }, endAt: { gt: rangeStart }, status: { in: ["APPROVED", "ASSIGNED"] } },
        select: { primaryDriverId: true, secondaryDriverId: true, vehicleId: true, startAt: true, endAt: true },
      }),
      prisma.onCallShift.findMany({ where: { date: { in: dayStartMs.map((t) => new Date(t)) } } }),
      loadWeightedEarnings(allDrivers.map((d) => d.id)),
    ]);

    const driverName = new Map(allDrivers.map((d) => [d.id, d.user.name ?? d.user.email ?? d.id]));
    const vehicleReg = new Map(vehicles.map((v) => [v.id, v.registrationNumber]));
    const dutyByDay = new Map(shifts.map((s) => [startOfDay(s.date).getTime(), s.driverId]));
    const slotVehicles: SlotInput[] = vehicles.map((v) => ({
      vehicleId: v.id,
      registrationNumber: v.registrationNumber,
      isDutyVehicle: v.isDutyVehicle,
    }));

    for (const b of waitlist) {
      const dayStart = startOfDay(b.startAt);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const driverTrips = new Map<string, { startAt: Date; endAt: Date }[]>();
      const vehicleTrips: { vehicleId: string | null; startAt: Date; endAt: Date }[] = [];
      for (const x of dayBookings) {
        if (!(x.startAt < dayEnd && x.endAt > dayStart)) continue;
        for (const id of [x.primaryDriverId, x.secondaryDriverId]) {
          if (!id) continue;
          const arr = driverTrips.get(id) ?? [];
          arr.push({ startAt: x.startAt, endAt: x.endAt });
          driverTrips.set(id, arr);
        }
        if (x.vehicleId) vehicleTrips.push({ vehicleId: x.vehicleId, startAt: x.startAt, endAt: x.endAt });
      }
      const reco = recommendOvertimePlacement({
        booking: { startAt: b.startAt, endAt: b.endAt },
        dutyDriverId: dutyByDay.get(dayStart.getTime()) ?? null,
        drivers: allDrivers.map((d) => ({
          driverId: d.id,
          earningsScore: earnings.get(d.id) ?? 0,
          lastAssignedAt: d.lastAssignedAt,
          trips: driverTrips.get(d.id) ?? [],
        })),
        vehicles: slotVehicles,
        vehicleTrips,
        day: dayStart,
      });
      if (reco.kind === "overtime-fit") {
        overtimeReco.set(b.id, {
          name: driverName.get(reco.driverId) ?? reco.driverId,
          reg: vehicleReg.get(reco.vehicleId) ?? reco.vehicleId,
          time: format(b.startAt, "HH:mm"),
        });
      }
    }
  }

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
                    {overtimeReco.has(b.id) && (
                      <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                        <Zap className="h-3.5 w-3.5 shrink-0" />
                        {t("overtimeFit", {
                          name: overtimeReco.get(b.id)!.name,
                          reg: overtimeReco.get(b.id)!.reg,
                          time: overtimeReco.get(b.id)!.time,
                        })}
                      </div>
                    )}
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
