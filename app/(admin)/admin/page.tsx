import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { format, startOfDay, subDays } from "date-fns";
import { ClipboardCheck, ListOrdered, CalendarClock, ChevronRight, UserCheck, Zap, AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { InChulaChip } from "@/components/in-chula-chip";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { OnCallShiftForm } from "@/components/forms/matching-form";
import { ApproverQueueActions } from "@/components/forms/approver-queue-actions";
import { loadWeightedEarnings } from "@/lib/booking/earnings";
import { recommendOvertimePlacement } from "@/lib/booking/overtime-reco";
import { SLOT_HOLDING_STATUSES, dayCapacity } from "@/lib/booking/slot-capacity";
import { triageFlags, waitingHours, SLA_WARN_HOURS, type TriageFlag } from "@/lib/booking/triage";
import { Section } from "@/components/section";

export default async function AdminQueue({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireAnyRole(["ADMIN"]);
  const isAdmin = session.user.roles.includes("ADMIN");
  const t = await getTranslations("admin");
  const tAuto = await getTranslations("matching");
  const now = new Date();
  const today = startOfDay(now);
  const urgentLabel = (await getTranslations("bookingForm"))("urgentBadge");

  // Free-text filter across the three lists (job number / purpose / destination
  // / requester / department) — the daily "find that one booking" need.
  const term = ((await searchParams).q ?? "").trim();
  const searchFilter: Prisma.BookingWhereInput = term
    ? {
        OR: [
          { jobNumber: { contains: term, mode: "insensitive" } },
          { purpose: { contains: term, mode: "insensitive" } },
          { destination: { contains: term, mode: "insensitive" } },
          { requester: { name: { contains: term, mode: "insensitive" } } },
          { department: { nameEn: { contains: term, mode: "insensitive" } } },
        ],
      }
    : {};

  // Shared console for ADMIN + APPROVER. Both see the full pipeline; the
  // detail page surfaces role-appropriate action forms.
  const [pending, approved, upcoming, todayShift, allDrivers] = await Promise.all([
    prisma.booking.findMany({
      // P'Top's decision queue: normal pending plus over-capacity WAITLIST
      // cases (the 11th+ booking of a day) for him to fit or deny.
      where: { status: { in: ["PENDING_APPROVAL", "WAITLIST"] }, ...searchFilter },
      orderBy: { startAt: "asc" },
      include: { requester: true, department: true },
    }),
    prisma.booking.findMany({
      where: { status: "APPROVED", ...searchFilter },
      orderBy: { createdAt: "asc" },
      take: 50, // bounded — the awaiting-assignment log shouldn't grow without limit
      include: { requester: true, department: true },
    }),
    prisma.booking.findMany({
      where: { status: "ASSIGNED", endAt: { gte: new Date() }, ...searchFilter },
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

    const [vehicles, dayBookings, shifts, earnings, unavailRows] = await Promise.all([
      prisma.vehicle.findMany({
        where: { isActive: true },
        select: { id: true, registrationNumber: true, assignedDriverId: true },
      }),
      prisma.booking.findMany({
        where: { startAt: { lt: rangeEnd }, endAt: { gt: rangeStart }, status: { in: ["APPROVED", "ASSIGNED"] } },
        select: { primaryDriverId: true, secondaryDriverId: true, vehicleId: true, startAt: true, endAt: true },
      }),
      prisma.onCallShift.findMany({ where: { date: { in: dayStartMs.map((t) => new Date(t)) } } }),
      loadWeightedEarnings(allDrivers.map((d) => d.id)),
      // Drivers marked off (sick/leave) on any waitlist day — excluded per day below.
      prisma.driverUnavailability.findMany({
        where: { date: { gte: rangeStart, lt: rangeEnd } },
        select: { driverId: true, date: true },
      }),
    ]);
    // Keyed by "driverId|yyyy-MM-dd" so the per-day match is TZ-robust.
    const offByDay = new Set(unavailRows.map((u) => `${u.driverId}|${format(u.date, "yyyy-MM-dd")}`));

    const driverName = new Map(allDrivers.map((d) => [d.id, d.user.name ?? d.user.email ?? d.id]));
    const vehicleReg = new Map(vehicles.map((v) => [v.id, v.registrationNumber]));
    const dutyByDay = new Map(shifts.map((s) => [startOfDay(s.date).getTime(), s.driverId]));
    // car=driver: driverId -> their assigned car.
    const driverCar = new Map<string, string>();
    for (const v of vehicles) if (v.assignedDriverId) driverCar.set(v.assignedDriverId, v.id);

    for (const b of waitlist) {
      const dayStart = startOfDay(b.startAt);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const driverTrips = new Map<string, { startAt: Date; endAt: Date }[]>();
      for (const x of dayBookings) {
        if (!(x.startAt < dayEnd && x.endAt > dayStart)) continue;
        for (const id of [x.primaryDriverId, x.secondaryDriverId]) {
          if (!id) continue;
          const arr = driverTrips.get(id) ?? [];
          arr.push({ startAt: x.startAt, endAt: x.endAt });
          driverTrips.set(id, arr);
        }
      }
      const dayKey = format(dayStart, "yyyy-MM-dd");
      const reco = recommendOvertimePlacement({
        booking: { startAt: b.startAt, endAt: b.endAt },
        dutyDriverId: dutyByDay.get(dayStart.getTime()) ?? null,
        drivers: allDrivers
          .filter((d) => !offByDay.has(`${d.id}|${dayKey}`))
          .map((d) => ({
          driverId: d.id,
          vehicleId: driverCar.get(d.id) ?? null,
          earningsScore: earnings.get(d.id) ?? 0,
          lastAssignedAt: d.lastAssignedAt,
          trips: driverTrips.get(d.id) ?? [],
        })),
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

  // Triage signals for the pending queue: risk/capacity chips + aging, so the
  // approver can prioritise which to open. Derived from data already in hand
  // plus three cheap grouped lookups; reuses the rule helpers (source of truth).
  const triageByBooking = new Map<string, TriageFlag[]>();
  let slaOverdue = 0;
  if (pending.length > 0) {
    const dayKeys = pending.map((b) => startOfDay(b.startAt).getTime());
    const rangeStart = new Date(Math.min(...dayKeys));
    const rangeEnd = new Date(Math.max(...dayKeys));
    rangeEnd.setDate(rangeEnd.getDate() + 1);
    const requesterIds = [...new Set(pending.map((b) => b.requesterId))];

    const [activeVehicles, daySlotBookings, cancellations] = await Promise.all([
      // Capacity counts only DISPATCHABLE cars (paired to an active driver),
      // matching the submit-time gate in createBookingAction.
      prisma.vehicle.findMany({
        where: {
          isActive: true,
          assignedDriver: { is: { isActive: true, user: { is: { isActive: true } } } },
        },
        select: { isDutyVehicle: true },
      }),
      prisma.booking.findMany({
        where: { status: { in: SLOT_HOLDING_STATUSES }, startAt: { gte: rangeStart, lt: rangeEnd } },
        select: { startAt: true },
      }),
      prisma.cancellation.findMany({
        where: { booking: { requesterId: { in: requesterIds } }, cancelledAt: { gte: subDays(now, 90) } },
        select: { booking: { select: { requesterId: true } } },
      }),
    ]);

    const cap = dayCapacity(
      activeVehicles.filter((v) => !v.isDutyVehicle).length,
      activeVehicles.filter((v) => v.isDutyVehicle).length,
    );
    const usedByDay = new Map<number, number>();
    for (const s of daySlotBookings) {
      const k = startOfDay(s.startAt).getTime();
      usedByDay.set(k, (usedByDay.get(k) ?? 0) + 1);
    }
    const cancelByRequester = new Map<string, number>();
    for (const c of cancellations) {
      const rid = c.booking.requesterId;
      cancelByRequester.set(rid, (cancelByRequester.get(rid) ?? 0) + 1);
    }

    for (const b of pending) {
      triageByBooking.set(
        b.id,
        triageFlags({
          startAt: b.startAt,
          endAt: b.endAt,
          province: b.province,
          isEmergency: b.isEmergency,
          now,
          dayUsed: usedByDay.get(startOfDay(b.startAt).getTime()) ?? 0,
          dayCapacity: cap,
          cancellations: cancelByRequester.get(b.requesterId) ?? 0,
        }),
      );
      if (waitingHours(b.createdAt, now) >= SLA_WARN_HOURS) slaOverdue++;
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("description", { count: approved.length })}
      />

      <form action="/admin" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={term}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="h-10 w-full max-w-xs rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {t("search")}
        </button>
        {term && (
          <Link
            href="/admin"
            className="inline-flex h-10 items-center rounded-md border px-4 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("clear")}
          </Link>
        )}
      </form>

      {slaOverdue > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {t("slaWaiting", { count: slaOverdue })}
        </div>
      )}

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
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <Link
                    href={`/admin/${b.id}`}
                    className="group -m-1 flex items-start justify-between gap-4 rounded-lg p-1 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                        <BookingStatusBadge status={b.status} />
                        <InChulaChip outsideChula={b.outsideChula} />
                        {b.isEmergency && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                            {urgentLabel}
                          </span>
                        )}
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
                      <TriageChips flags={triageByBooking.get(b.id) ?? []} waitedHours={waitingHours(b.createdAt, now)} t={t} />
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  {isAdmin && (
                    <ApproverQueueActions
                      bookingId={b.id}
                      canDeny={b.status === "PENDING_APPROVAL"}
                    />
                  )}
                </div>
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
                      {b.isEmergency && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                          {urgentLabel}
                        </span>
                      )}
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
                      {b.isEmergency && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                          {urgentLabel}
                        </span>
                      )}
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

type AdminT = Awaited<ReturnType<typeof getTranslations<"admin">>>;

function Pill({ tone, children }: { tone: "amber" | "rose"; children: string }) {
  const cls =
    tone === "rose"
      ? "bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-300"
      : "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

// Risk/capacity/aging chips for one pending request. Aging shows after 12h
// (amber), escalating to rose past 48h; per-flag tone marks the urgent ones.
function TriageChips({ flags, waitedHours, t }: { flags: TriageFlag[]; waitedHours: number; t: AdminT }) {
  const showAging = waitedHours >= 12;
  if (flags.length === 0 && !showAging) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {flags.map((f, i) => {
        const tone: "amber" | "rose" = f.key === "emergency" || f.key === "dayFull" ? "rose" : "amber";
        const label =
          f.key === "dayFull"
            ? t("triageDayFull", { used: f.used, capacity: f.capacity })
            : f.key === "repeatCanceller"
              ? t("triageRepeatCanceller", { count: f.count })
              : f.key === "outOfHours"
                ? t("triageOutOfHours")
                : f.key === "shortLead"
                  ? t("triageShortLead")
                  : t("triageEmergency");
        return (
          <Pill key={i} tone={tone}>
            {label}
          </Pill>
        );
      })}
      {showAging && (
        <Pill tone={waitedHours >= SLA_WARN_HOURS * 2 ? "rose" : "amber"}>
          {waitedHours >= 24
            ? t("triageWaitingDays", { days: Math.floor(waitedHours / 24) })
            : t("triageWaitingHours", { hours: waitedHours })}
        </Pill>
      )}
    </div>
  );
}
