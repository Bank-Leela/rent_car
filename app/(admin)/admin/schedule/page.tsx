import Link from "next/link";
import { addDays, format, parse, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BoardDatePicker } from "@/components/admin/board-date-picker";
import { ensureOnCallRosterThrough } from "@/lib/booking/duty-roster";
import { DriverRosterControl } from "@/components/admin/driver-roster-control";
import { SchedulerBoard } from "@/components/admin/scheduler-board";
import { WernStrip, type WernJob } from "@/components/admin/wern-strip";
import { loadTimelineBoard } from "@/lib/booking/timeline-board-data";
import { formatTh } from "@/lib/format-date";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  await requireRole("ADMIN");
  const t = await getTranslations("scheduler");
  const locale = await getLocale();

  const { date } = await searchParams;
  // ONE board here now, and it is the timeline. The rounds whiteboard belongs to
  // the driver kiosk (/driver/schedule): it answers "what am I running today",
  // which is the driver's question, and it was only ever on this page because
  // both views were built for admin before the kiosk existed. Admin's question
  // is "change the day", and that is the timeline's whole reason to exist.
  //
  // `?view=` is deliberately no longer read. A bookmarked ?view=timeline link
  // still lands here correctly because there is nothing else to land on.
  const day = date ? parse(date, "yyyy-MM-dd", new Date()) : new Date();
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  // The เวร roster extends itself: opening a future day tops it up so the board
  // never shows an unmanned day, and the allocator sees the same stored shifts.
  await ensureOnCallRosterThrough(dayStart);

  const [vehicles, dayBookings] = await Promise.all([
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
        coordinatorName: true,
        coordinatorPhone: true,
        ajarnName: true,
        ajarnPhone: true,
        primaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
        secondaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
      },
    }),
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
    "inline-flex h-11 w-11 items-center justify-center rounded-md border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const wernJobs: WernJob[] = internalDayBookings
    .filter((b) => b.jobType === "WERN")
    .map((b) => ({
      id: b.id,
      destination: b.destination,
      driverName: b.primaryDriver?.user
        ? (isThai ? b.primaryDriver.user.thaiName ?? b.primaryDriver.user.name : b.primaryDriver.user.name) ?? null
        : null,
      startHHmm: formatTh(b.startAt, "HH:mm"),
      endHHmm: formatTh(b.endAt, "HH:mm"),
      dateLabel: formatTh(b.startAt, "EEE d MMM yyyy"),
    }));

  // The only board on this page.
  const timelineData = await loadTimelineBoard(dayStart, isThai);

  const body = (
    <>
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


      <WernStrip jobs={wernJobs} labels={{ title: t("wernStripTitle"), empty: "" }} />

      <SchedulerBoard
        vehicles={timelineData.vehicles}
        bookings={timelineData.bookings}
        dutyVehicleId={timelineData.dutyVehicleId}
        date={isoOf(dayStart)}
        adHocRows={timelineData.adHocRows}
      />

    </>
  );

  // No RoundsDnd provider any more: it existed to let a trip cross between the
  // unassigned bar, the driver rows and the hired rows on the whiteboard, and
  // the whiteboard is not on this page. SchedulerBoard brings its own
  // DndContext, so admin keeps drag-to-assign — just the timeline's, against an
  // hour axis, which is the one that can also move a เวร job's hours.
  return <div className="space-y-6">{body}</div>;
}
