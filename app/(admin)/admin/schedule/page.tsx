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
import { AdHocRowsPanel, type AdHocPanelRow, type WaitingTrip } from "@/components/admin/adhoc-rows-panel";
import { laterUnplacedSiblings } from "@/lib/booking/adhoc-actions";
import { UnassignedBar, type UnassignedRow } from "@/components/admin/unassigned-bar";
import { SchedulerBoard } from "@/components/admin/scheduler-board";
import { WernStrip, type WernJob } from "@/components/admin/wern-strip";
import { loadTimelineBoard } from "@/lib/booking/timeline-board-data";
import { recommendForBookings } from "@/lib/booking/placement-reco-data";
import { formatTh } from "@/lib/format-date";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  await requireRole("ADMIN");
  const t = await getTranslations("scheduler");
  const tsim = await getTranslations("simulate");
  const tj = await getTranslations("jobType");
  const locale = await getLocale();

  const { date, view } = await searchParams;
  // The whiteboard is for reading the day; the timeline is for changing it.
  const timeline = view === "timeline";
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
      destination: b.destination,
      startAt: b.startAt,
      endAt: b.endAt,
      jobType: b.jobType,
      primaryDriverId: b.primaryDriverId,
      secondaryDriverId: b.secondaryDriverId,
      // The coordinator is the person meeting the car; the requester is the fallback.
      contactName: b.coordinatorName || b.ajarnName,
      contactPhone: b.coordinatorPhone || b.ajarnPhone,
    })),
    dayStart,
    dayEnd,
    dutyDriverId: onCall?.driverId ?? null,
    offDriverIds: roster.filter((r) => r.off).map((r) => r.driverId),
  });

  // Outside vehicles hired for this day. These already drove the timeline board;
  // the rounds board is the view P'Top actually lands on, so they belong here
  // too — otherwise the feature exists but is never seen.
  const adHocRaw = await prisma.adHocVehicle.findMany({
    where: { date: dayStart },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      label: true,
      cost: true,
      contactName: true,
      contactPhone: true,
      bookings: {
        where: { status: "OUTSOURCED" },
        orderBy: { startAt: "asc" },
        select: {
          id: true, startAt: true, endAt: true, destination: true,
          recurrenceParentId: true,
        },
      },
    },
  });

  // For each trip on a hired vehicle: how many LATER occurrences of its series
  // still have no vehicle at all. Non-zero means the vendor was arranged for this
  // date only and the rest of the series is stranded — which is what happens to
  // anything attached before the carry-forward existed.
  const strandedBySourceBooking = new Map<string, number>();
  for (const r of adHocRaw) {
    for (const b of r.bookings) {
      const seriesKey = b.recurrenceParentId ?? b.id;
      const siblings = await laterUnplacedSiblings(seriesKey, b.startAt, b.id);
      if (siblings.length > 0) strandedBySourceBooking.set(b.id, siblings.length);
    }
  }

  const adHocPanelRows: AdHocPanelRow[] = adHocRaw.map((r) => ({
    id: r.id,
    label: r.label,
    cost: r.cost != null ? String(r.cost) : null,
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    trips: r.bookings.map((b) => ({
      id: b.id,
      timeLabel: `${formatTh(b.startAt, "HH:mm")}–${formatTh(b.endAt, "HH:mm")}`,
      place: b.destination,
      strandedSiblings: strandedBySourceBooking.get(b.id) ?? 0,
    })),
  }));
  const adHocTargets = adHocRaw.map((r) => ({ id: r.id, label: r.label }));

  // Outsourced on this day but attached to no row yet. The query above reaches
  // outsourced trips only THROUGH an AdHocVehicle, so approving a full day onto
  // an outside rental produced a trip that appeared on no board at all — while
  // the requester's own list still showed it as arranged.
  const adHocWaitingRaw = await prisma.booking.findMany({
    where: {
      status: "OUTSOURCED",
      adHocVehicleId: null,
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
    },
    orderBy: { startAt: "asc" },
    select: { id: true, purpose: true, destination: true, startAt: true, endAt: true },
  });
  const adHocWaiting: WaitingTrip[] = adHocWaitingRaw.map((b) => ({
    id: b.id,
    purpose: b.purpose,
    place: b.destination,
    timeLabel: `${formatTh(b.startAt, "HH:mm")}–${formatTh(b.endAt, "HH:mm")}`,
  }));

  // Only pay for the timeline's ~270 lines of mapping when it is the view.
  const timelineData = timeline ? await loadTimelineBoard(dayStart, isThai) : null;

  // เวร jobs for this day, whose hours P'Top may move (see WernStrip).
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
    }));

  // Everything still needing a car on this day. Deliberately NOT filtered on
  // overflowReason: TJW / urgent / hired-bus never reach the solver, so they
  // never carry one, and keying on it would hide them entirely now that the
  // /admin รอจัดรถ list is gone.
  const unassigned = await prisma.booking.findMany({
    where: {
      OR: [
        { status: "APPROVED", primaryDriverId: null, startAt: { gte: dayStart, lt: dayEnd } },
        // Trips that DO have a driver but still need P'Top: one whose driver went
        // off sick/on leave while it was already under way or spanning in from an
        // earlier day (never re-dispatched automatically), and one that lost the
        // second driver a >400 km run requires. Neither is unassigned, so the
        // "APPROVED with no driver" key alone would leave both invisible.
        // Overlap-matched, not start-matched — a multi-day ตจว flagged on its
        // second day started on its first.
        {
          status: { in: ["APPROVED", "ASSIGNED"] },
          primaryDriverId: { not: null },
          overflowReason: { in: ["DRIVER_OFF_NEEDS_REVIEW", "NO_SECONDARY_DRIVER"] },
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
      ],
    },
    orderBy: { startAt: "asc" },
    select: {
      id: true, destination: true, startAt: true, endAt: true,
      jobType: true, isEmergency: true, preferredVehicleType: true, overflowReason: true,
      estimatedDistance: true, primaryDriverId: true, needsOutsourcing: true,
    },
  });

  // A recommendation only exists for bookings the solver actually considered —
  // and only for ones that still need placing. A flagged booking already has a
  // car; offering to "assign" it would double-book its own driver.
  // SMUS belongs in this exclusion for the same reason as the others: it can
  // never take a faculty car. Without it, an approved หลักสูตรนิสิตแพทย์ charter got
  // a placement recommendation naming a real car and a live จัดให้ button, and
  // every press failed — reassignVehicleAction rejects SMUS outright
  // (schedule-actions.ts), so the row could never clear and there was no hint why.
  const recoInputs = unassigned.filter(
    (b) =>
      b.primaryDriverId === null &&
      b.jobType !== "TJW" &&
      b.jobType !== "SMUS" &&
      !b.isEmergency &&
      b.preferredVehicleType !== "BUS_OUTSOURCED",
  );
  const recos = recoInputs.length ? await recommendForBookings(dayStart, recoInputs, isThai) : new Map();

  const unassignedRows: UnassignedRow[] = unassigned.map((b) => {
    // A driver-off flag outranks the kind-of-job labels: a multi-day ตจว flagged
    // because its driver fell sick is not sitting here for the usual "ตจว is
    // always placed by hand" reason, and saying so would hide why it appeared.
    const reason =
      b.overflowReason === "DRIVER_OFF_NEEDS_REVIEW" ? tsim("reason_DRIVER_OFF_NEEDS_REVIEW")
      : b.primaryDriverId ? tsim(`reason_${b.overflowReason ?? "NO_SECONDARY_DRIVER"}`)
      : b.jobType === "TJW" ? t("reasonManualTjw")
      // Ahead of isEmergency on purpose. A charter can never take a faculty car
      // whether or not it is urgent, so "this does not use the fleet at all" is
      // the more load-bearing fact; ranked below, an urgent charter read as
      // "จองเร่งด่วน (จัดเอง)", which invites someone to go and place it by hand.
      // Before the branch existed at all it fell through to reasonNotPlacedYet —
      // "press จัดให้ or wait for the automatic round" — and both halves of that
      // are false: the button always failed for SMUS and the solver deliberately
      // never sees it.
      : b.jobType === "SMUS" ? t("reasonExternalCharter")
      : b.isEmergency ? t("reasonManualUrgent")
      : b.preferredVehicleType === "BUS_OUTSOURCED" ? t("reasonManualBus")
      // A NULL overflowReason means the solver has never rejected this booking —
      // usually it simply has not run for it yet. Falling back to
      // NO_PRIMARY_DRIVER stated a specific cause ("rotation, the 2 h gap, or a
      // full daily quota") that nothing had established, which reads as nonsense
      // on a day where every driver is free.
      : b.overflowReason ? tsim(`reason_${b.overflowReason}`)
      : t("reasonNotPlacedYet");
    const r = recos.get(b.id);
    return {
      id: b.id,
      destination: b.destination,
      timeLabel: `${formatTh(b.startAt, "HH:mm")}–${formatTh(b.endAt, "HH:mm")}`,
      reasonLabel: reason,
      reco: r ? { vehicleId: r.vehicleId, secondaryDriverId: r.secondaryDriverId ?? null, label: r.assignLabel ?? r.label } : null,
      // A hired vehicle is the answer for these, not a faculty car. Before this
      // they were the rows with no action at all — the solver has nothing to
      // offer them, so they fell through to "open the request" and sat here.
      outsideCandidate:
        b.preferredVehicleType === "BUS_OUTSOURCED" ||
        b.jobType === "SMUS" ||
        b.needsOutsourcing,
    };
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


      {/* The timeline carries its own unassigned queue — the thing you drag FROM —
          so showing this bar as well would be the same list twice. */}
      {!timeline && (
      <UnassignedBar
        rows={unassignedRows}
        outsideTargets={adHocTargets}
        labels={{
          title: t("unassignedTitle"),
          empty: t("unassignedEmpty"),
          open: t("unassignedOpen"),
        }}
      />
      )}

      <WernStrip
        jobs={wernJobs}
        date={isoOf(dayStart)}
        labels={{ title: t("wernStripTitle"), empty: "" }}
      />

      {/* Two views of the same day. The whiteboard answers "what is happening",
          the timeline lets P'Top change it by dragging — including moving a เวร
          job's hours, which only makes sense against an hour axis. */}
      <div className="flex gap-1 rounded-md border bg-muted/30 p-1 text-sm">
        <Link
          href={`/admin/schedule?date=${isoOf(dayStart)}`}
          className={`rounded px-3 py-1 ${!timeline ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:bg-muted"}`}
        >
          {t("viewRounds")}
        </Link>
        <Link
          href={`/admin/schedule?date=${isoOf(dayStart)}&view=timeline`}
          className={`rounded px-3 py-1 ${timeline ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:bg-muted"}`}
        >
          {t("viewTimeline")}
        </Link>
      </div>

      {timelineData ? (
        <SchedulerBoard
          vehicles={timelineData.vehicles}
          bookings={timelineData.bookings}
          dutyVehicleId={timelineData.dutyVehicleId}
          date={isoOf(dayStart)}
          adHocRows={timelineData.adHocRows}
        />
      ) : (
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
        adHocTargets={adHocTargets}
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
      )}

      {/* Outside vehicles sit under the fleet's own rows on the rounds board.
          The timeline carries its own copy (you drag onto it there), so showing
          both at once would be the same rows twice. */}
      {!timeline && (
        <AdHocRowsPanel date={isoOf(dayStart)} rows={adHocPanelRows} waiting={adHocWaiting} />
      )}
    </div>
  );
}
