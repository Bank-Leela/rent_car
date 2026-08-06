import Link from "next/link";
import { addDays, format, parse, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { DriverRoundsBoard } from "@/components/driver/driver-rounds-board";
import { BoardDatePicker } from "@/components/admin/board-date-picker";
import { buildDriverRounds } from "@/lib/booking/driver-rounds";
import { ensureOnCallRosterThrough } from "@/lib/booking/duty-roster";
import { DriverRosterControl } from "@/components/admin/driver-roster-control";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole("ADMIN");
  const t = await getTranslations("scheduler");
  const tj = await getTranslations("jobType");
  const locale = await getLocale();

  const { date } = await searchParams;
  const day = date ? parse(date, "yyyy-MM-dd", new Date()) : new Date();
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  // The เวร roster extends itself: opening a future day tops it up so the board
  // never shows an unmanned day, and the allocator sees the same stored shifts.
  await ensureOnCallRosterThrough(dayStart);

  const [vehicles, dayBookings, onCall] = await Promise.all([
    prisma.vehicle.findMany({
      where: { isActive: true },
      // Stable order so the A–F labels stay put day-to-day (duty rotates, not the label).
      orderBy: { registrationNumber: "asc" },
      select: {
        id: true,
        registrationNumber: true,
        assignedDriverId: true,
        assignedDriver: { select: { user: { select: { name: true, thaiName: true } } } },
      },
    }),
    prisma.booking.findMany({
      where: {
        status: { in: ["APPROVED", "ASSIGNED"] },
        // Overlap, not start-in-day: a multi-day TJW must appear on every day it
        // spans (departure, any middle day, and the return day) so the board
        // shows the car/driver committed until they get back.
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
      },
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        jobNumber: true,
        purpose: true,
        destination: true,
        travelWithinChula: true,
        googleMapsUrl: true,
        waitAtDestination: true,
        dropOffDone: true,
        pickupReturnTime: true,
        startAt: true,
        endAt: true,
        vehicleId: true,
        jobType: true,
        estimatedDistance: true,
        createdAt: true,
        primaryDriverId: true,
        secondaryDriverId: true,
        primaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
        secondaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
      },
    }),
    prisma.onCallShift.findUnique({ where: { date: dayStart }, select: { driverId: true } }),
  ]);

  const isThai = locale.toLowerCase().startsWith("th");
  // car=driver: which car each driver is assigned to, to place a co-driver ghost.
  const carByDriver = new Map<string, string>();
  for (const v of vehicles) if (v.assignedDriverId) carByDriver.set(v.assignedDriverId, v.id);

  // Roster: every schedulable driver + whether they're marked off (sick/leave)
  // for the viewed day. Marking off excludes them from the day's auto-assign.
  const rosterDrivers = await prisma.driver.findMany({
    where: { isActive: true, user: { is: { isActive: true } } },
    select: {
      id: true,
      user: { select: { name: true, thaiName: true } },
      assignedVehicle: { select: { registrationNumber: true } },
      unavailabilities: { where: { date: dayStart }, select: { id: true } },
    },
  });
  const roster = rosterDrivers
    .map((d) => ({
      driverId: d.id,
      name: (isThai ? d.user.thaiName ?? d.user.name : d.user.name ?? d.user.thaiName) ?? d.id,
      carReg: d.assignedVehicle?.registrationNumber ?? null,
      off: d.unavailabilities.length > 0,
    }))
    .sort((a, b) => (a.carReg ?? "~").localeCompare(b.carReg ?? "~") || a.name.localeCompare(b.name));

  // External charter (SMUS) never enters the internal fleet; the rounds board
  // shows internal driver assignments only.
  const internalDayBookings = dayBookings.filter((b) => b.jobType !== "SMUS");

  const isoOf = (d: Date) => format(d, "yyyy-MM-dd");
  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  // Whiteboard-style rounds view (same component the kiosk shows). Read-only:
  // assignment stays on /admin/batch (auto-assign, TJW run, overflow recos).
  const roundRows = buildDriverRounds({
    drivers: vehicles
      .filter((v) => v.assignedDriverId)
      .map((v) => {
        const du = v.assignedDriver?.user;
        return {
          driverId: v.assignedDriverId!,
          driverName: du ? (isThai ? du.thaiName ?? du.name : du.name ?? du.thaiName) ?? null : null,
          registrationNumber: v.registrationNumber,
        };
      }),
    bookings: internalDayBookings.map((b) => ({
      id: b.id,
      jobNumber: b.jobNumber,
      destination: b.destination,
      startAt: b.startAt,
      endAt: b.endAt,
      jobType: b.jobType,
      primaryDriverId: b.primaryDriverId,
      secondaryDriverId: b.secondaryDriverId,
    })),
    dayStart,
    dayEnd,
    dutyDriverId: onCall?.driverId ?? null,
    offDriverIds: roster.filter((r) => r.off).map((r) => r.driverId),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/schedule?date=${isoOf(addDays(dayStart, -1))}`}
            className={navBtn}
            aria-label={t("prevDay")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <BoardDatePicker basePath="/admin/schedule" date={isoOf(dayStart)} />
          <Link
            href={`/admin/schedule?date=${isoOf(addDays(dayStart, 1))}`}
            className={navBtn}
            aria-label={t("nextDay")}
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <DriverRosterControl drivers={roster} date={isoOf(dayStart)} />

      <DriverRoundsBoard
        rows={roundRows}
        href={(id) => `/admin/${id}`}
        reassignTargets={vehicles
          .filter((v) => v.assignedDriverId)
          .map((v) => {
            const du = v.assignedDriver?.user;
            return {
              vehicleId: v.id,
              driverId: v.assignedDriverId!,
              driverName: du ? (isThai ? du.thaiName ?? du.name : du.name ?? du.thaiName) ?? null : null,
              registrationNumber: v.registrationNumber,
            };
          })}
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
