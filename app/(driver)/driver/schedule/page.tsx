import Link from "next/link";
import { addDays, format, parse, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { DriverRoundsBoard } from "@/components/driver/driver-rounds-board";
import { BoardDatePicker } from "@/components/admin/board-date-picker";
import { buildDriverRounds } from "@/lib/booking/driver-rounds";
import { ensureOnCallRosterThrough } from "@/lib/booking/duty-roster";
import { TodayTripsPanel, type TodayTripRow } from "@/components/driver/today-trips-panel";
import { KioskRefresh } from "@/components/driver/kiosk-refresh";

// Driver-side board. The shared "driverstation" login lands here. Read-only:
// P'Top's official schedule. Drivers no longer self-schedule — P'Top decides
// every assignment on the admin board (the old editable draft/trade tab is gone).
export default async function DriverSchedule({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole("DRIVER");
  const t = await getTranslations("scheduler");
  const td = await getTranslations("driver");
  const tj = await getTranslations("jobType");
  const locale = await getLocale();
  const isThai = locale.toLowerCase().startsWith("th");

  const { date } = await searchParams;
  const day = date ? parse(date, "yyyy-MM-dd", new Date()) : new Date();
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  // The เวร roster extends itself: opening a future day tops it up so the board
  // never shows an unmanned day, and the allocator sees the same stored shifts.
  await ensureOnCallRosterThrough(dayStart);

  const [vehicles, dayBookings, onCall, offToday] = await Promise.all([
    prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: { registrationNumber: "asc" },
      select: {
        id: true,
        registrationNumber: true,
        assignedDriverId: true,
        assignedDriver: { select: { user: { select: { name: true, thaiName: true } } } },
      },
    }),
    prisma.booking.findMany({
      where: { status: { in: ["APPROVED", "ASSIGNED"] }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
      orderBy: { startAt: "asc" },
      select: {
        id: true, purpose: true, destination: true, startAt: true, endAt: true,
        vehicleId: true, jobType: true, estimatedDistance: true,
        primaryDriverId: true, secondaryDriverId: true,
        coordinatorName: true, coordinatorPhone: true, ajarnName: true, ajarnPhone: true,
        primaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
        secondaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
        status: true,
        trip: { select: { startedAt: true, endedAt: true } },
      },
    }),
    prisma.onCallShift.findUnique({ where: { date: dayStart }, select: { driverId: true } }),
    // Who is off sick / on leave today — the kiosk should show it, not just the
    // admin board: a driver arriving to an empty row needs to know why.
    prisma.driverUnavailability.findMany({ where: { date: dayStart }, select: { driverId: true } }),
  ]);

  const dutyDriverId = onCall?.driverId ?? null;
  const nameOf = (u: { name: string | null; thaiName: string | null } | null | undefined) =>
    u ? (isThai ? u.thaiName ?? u.name : u.name ?? u.thaiName) ?? null : null;

  const vehicleRows = vehicles.map((v) => ({
    id: v.id,
    registrationNumber: v.registrationNumber,
    driverName: nameOf(v.assignedDriver?.user),
  }));

  // Whiteboard-style rounds: one row per car-paired driver, their day's trips as
  // chips (depart–return · place). Pure view mapping — assignment is unchanged.
  const roundRows = buildDriverRounds({
    drivers: vehicles
      .filter((v) => v.assignedDriverId)
      .map((v) => ({
        driverId: v.assignedDriverId!,
        driverName: nameOf(v.assignedDriver?.user),
        registrationNumber: v.registrationNumber,
      })),
    bookings: dayBookings.map((b) => ({
      id: b.id,
      destination: b.destination,
      startAt: b.startAt,
      endAt: b.endAt,
      jobType: b.jobType,
      primaryDriverId: b.primaryDriverId,
      secondaryDriverId: b.secondaryDriverId,
      // The coordinator is the person meeting the car; the requester is the fallback.
      contactName: b.coordinatorName || b.ajarnName,
      contactPhone: b.coordinatorPhone || b.ajarnPhone,
      tripStartedAt: b.trip?.startedAt ?? null,
      tripEndedAt: b.trip?.endedAt ?? null,
    })),
    dayStart,
    dayEnd,
    dutyDriverId,
    offDriverIds: offToday.map((o) => o.driverId),
  });

  const isoOf = (d: Date) => format(d, "yyyy-MM-dd");
  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  // "Today at a glance": the viewed day's dispatched trips in leave order. Only
  // rendered when the kiosk is actually showing today, where "next within the
  // hour" means something.
  const viewingToday = dayStart.getTime() === startOfDay(new Date()).getTime();
  const regByVehicle = new Map(vehicleRows.map((v) => [v.id, v.registrationNumber]));
  let todayRows: TodayTripRow[] = [];
  if (viewingToday) {
    const nowMs = new Date().getTime();
    const dispatched = dayBookings
      .filter((b) => b.status === "ASSIGNED" || b.trip != null)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const nextId = dispatched.find(
      (b) => !b.trip && b.startAt.getTime() > nowMs && b.startAt.getTime() - nowMs <= 60 * 60 * 1000,
    )?.id;
    todayRows = dispatched.map((b) => ({
      id: b.id,
      startLabel: format(b.startAt, "HH:mm"),
      destination: b.destination,
      driverName: nameOf(b.primaryDriver?.user),
      registrationNumber: b.vehicleId ? regByVehicle.get(b.vehicleId) ?? null : null,
      state: b.trip?.endedAt ? "done" : b.trip ? "inProgress" : "upcoming",
      isNext: b.id === nextId,
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader title={td("scheduleTitle")} description={td("scheduleSubtitle")} />
        <div className="flex flex-wrap items-center gap-2">
          <KioskRefresh />
          <Link href={`/driver/schedule?date=${isoOf(addDays(dayStart, -1))}`} className={navBtn} aria-label={t("prevDay")}>
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <BoardDatePicker basePath="/driver/schedule" date={isoOf(dayStart)} />
          <Link href={`/driver/schedule?date=${isoOf(addDays(dayStart, 1))}`} className={navBtn} aria-label={t("nextDay")}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {viewingToday && (
        <TodayTripsPanel
          rows={todayRows}
          labels={{
            title: td("todayPanelTitle"),
            empty: td("todayPanelEmpty"),
            upcoming: td("todayStateUpcoming"),
            inProgress: td("todayStateInProgress"),
            done: td("todayStateDone"),
            next: td("todayNext"),
          }}
        />
      )}

      <DriverRoundsBoard
        rows={roundRows}
        // Tapping a round opens that trip, where the driver records the start /
        // end mileage and can open the official form for the passenger to sign.
        href={(id) => `/driver/${id}`}
        labels={{
          duty: t("duty"),
          off: t("roundsOff"),
          free: t("roundsFree"),
          coDriver: t("coDriver"),
          empty: t("noVehicles"),
          overnight: t("roundsOvernight"),
          nightOf: t("roundsNightOf"),
          backOn: t("roundsBackOn"),
          leftOn: t("roundsLeftOn"),
          returnAt: t("roundsReturnAt"),
        }}
        legend={{
          TJW: tj("TJW"),
          OT: tj("OT"),
          WERN: tj("WERN"),
          NORMAL: tj("NORMAL"),
          dutyRow: t("roundsDutyRow"),
          offRow: t("roundsOffRow"),
        }}
      />
    </div>
  );
}
