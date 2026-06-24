import Link from "next/link";
import { addDays, format, parse, startOfDay } from "date-fns";
import { th, enUS } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { SchedulerBoard } from "@/components/admin/scheduler-board";
import { type SchedulerBooking, carLabel } from "@/components/admin/scheduler-board-shared";
import { DriverRosterControl } from "@/components/admin/driver-roster-control";
import { DraftReviewPanel, type DraftMove } from "@/components/admin/draft-review-panel";
import { recommendForBookings } from "@/lib/booking/placement-reco-data";
import { findConflictLosers } from "@/lib/booking/conflict-resolve";
import { LONG_TRIP_KM } from "@/lib/booking/classification";
import { daySpan, daySuperscript } from "@/lib/booking/day-window";

// Compact clock for the board's narrow blocks: drop ":00" so a 2h block fits its
// own start–end ("08:00–12:00" → "08–12"); keep the minutes only when non-zero.
const hm = (d: Date) => (d.getMinutes() === 0 ? format(d, "HH") : format(d, "HH:mm"));

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole("ADMIN");
  const t = await getTranslations("scheduler");
  const locale = await getLocale();
  const dfLocale = locale.toLowerCase().startsWith("th") ? th : enUS;

  const { date } = await searchParams;
  const day = date ? parse(date, "yyyy-MM-dd", new Date()) : new Date();
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  const [vehicles, dayBookings, onCall, adHocRowsRaw, outsourcedRaw, submittedDrafts] = await Promise.all([
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
        outsideChula: true,
        googleMapsUrl: true,
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
    // Per-day external/outside-driver rows + the trips outsourced to them.
    prisma.adHocVehicle.findMany({
      where: { date: dayStart },
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, cost: true },
    }),
    prisma.booking.findMany({
      where: {
        status: "OUTSOURCED",
        adHocVehicleId: { not: null },
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
      },
      orderBy: { startAt: "asc" },
      select: {
        id: true, jobNumber: true, purpose: true, destination: true, startAt: true, endAt: true,
        outsideChula: true, googleMapsUrl: true,
        vehicleId: true, jobType: true, estimatedDistance: true, createdAt: true,
        primaryDriverId: true, secondaryDriverId: true,
        primaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
        secondaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
        adHocVehicleId: true,
      },
    }),
    // Submitted driver trade draft (global, not day-scoped) for P'Top's review banner.
    prisma.bookingDraft.findMany({
      where: { submitted: true },
      orderBy: { booking: { startAt: "asc" } },
      select: {
        bookingId: true,
        proposedVehicleId: true,
        booking: { select: { jobNumber: true, purpose: true, startAt: true, vehicleId: true } },
      },
    }),
  ]);

  // car=driver: the duty car is the on-call driver's own car — always resolvable.
  const dutyDriverId = onCall?.driverId ?? null;
  const dutyVehicleId = dutyDriverId
    ? vehicles.find((v) => v.assignedDriverId === dutyDriverId)?.id ?? null
    : null;

  const isThai = locale.toLowerCase().startsWith("th");
  // car=driver: which car each driver is assigned to, to place a co-driver ghost.
  const carByDriver = new Map<string, string>();
  for (const v of vehicles) if (v.assignedDriverId) carByDriver.set(v.assignedDriverId, v.id);
  const vehicleRows = vehicles.map((v) => {
    const du = v.assignedDriver?.user;
    const driverName = du ? (isThai ? du.thaiName ?? du.name : du.name ?? du.thaiName) ?? null : null;
    return { id: v.id, registrationNumber: v.registrationNumber, driverName };
  });

  // Human label for a car (A–F · driver) or the queue, for the trade-draft banner.
  const carDesc = (vid: string | null) => {
    if (!vid) return t("draftQueueLabel");
    const i = vehicleRows.findIndex((v) => v.id === vid);
    if (i < 0) return "—";
    const v = vehicleRows[i]!;
    return `${carLabel(i)} · ${v.driverName ?? v.registrationNumber}`;
  };
  const draftMoves: DraftMove[] = submittedDrafts.map((d) => ({
    bookingId: d.bookingId,
    jobNumber: d.booking.jobNumber,
    purpose: d.booking.purpose,
    startLabel: format(d.booking.startAt, "EEE d MMM HH:mm", { locale: dfLocale }),
    from: carDesc(d.booking.vehicleId),
    to: carDesc(d.proposedVehicleId),
  }));

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

  // Placement recommendation for each unassigned (queue) booking — the same
  // suggestion the batch overflow list shows, surfaced on the board's queue.
  const queueRaw = dayBookings
    .filter((b) => !b.vehicleId)
    .map((b) => ({ id: b.id, startAt: b.startAt, endAt: b.endAt, estimatedDistance: b.estimatedDistance, jobType: b.jobType }));
  const recos = await recommendForBookings(dayStart, queueRaw, isThai);
  const dutyTag = t("duty");
  const assignReco = t("assignReco");
  const bookings = dayBookings.map((b) => {
    const u = b.primaryDriver?.user;
    const driverName = u ? (isThai ? u.thaiName ?? u.name : u.name ?? u.thaiName) ?? null : null;
    const su = b.secondaryDriver?.user;
    const secondaryDriverName = su ? (isThai ? su.thaiName ?? su.name : su.name ?? su.thaiName) ?? null : null;
    // Project the (possibly multi-day) trip onto this viewed day.
    const span = daySpan(b.startAt, b.endAt, dayStart, dayEnd);
    const r = recos.get(b.id);
    const longTrip = (b.estimatedDistance ?? 0) > LONG_TRIP_KM;
    const reco =
      r && r.kind !== "none"
        ? {
            vehicleId: r.vehicleId,
            secondaryDriverId: r.secondaryDriverId,
            label:
              `${r.registrationNumber ?? ""}${r.driverName ? " · " + r.driverName : ""}` +
              `${r.kind === "reclaim" ? ` (${dutyTag})` : ""}` +
              `${r.secondaryDriverName ? " + " + r.secondaryDriverName : longTrip ? " + ?" : ""}`,
            assignLabel: assignReco,
          }
        : null;
    return {
      id: b.id,
      jobNumber: b.jobNumber,
      purpose: b.purpose,
      destination: b.destination,
      outsideChula: b.outsideChula,
      googleMapsUrl: b.googleMapsUrl,
      // On its departure day a trip shows its start time; on a later (return or
      // middle) day it shows "↪ <departure date>" so it's clear it's continuing.
      timeLabel: span.continuesBefore
        ? `↪ ${format(b.startAt, "EEE d MMM", { locale: dfLocale })}`
        : hm(b.startAt),
      // Ending the same day → just the time; ending a later day → the return time
      // plus the return date ("↩ <date>").
      endLabel: span.continuesAfter
        ? `${hm(b.endAt)} ↩ ${format(b.endAt, "EEE d MMM", { locale: dfLocale })}`
        : hm(b.endAt),
      // Airline-style depart/arrive for the both-ends multi-day rendering: time +
      // a day-offset marker relative to the viewed day ("18:00⁺1" = next day).
      departLabel: hm(b.startAt) + daySuperscript(b.startAt, dayStart),
      arriveLabel: hm(b.endAt) + daySuperscript(b.endAt, dayStart),
      startHour: span.startHour,
      endHour: span.endHour,
      continuesBefore: span.continuesBefore,
      continuesAfter: span.continuesAfter,
      vehicleId: b.vehicleId,
      jobType: b.jobType,
      hasDriver: b.primaryDriverId != null,
      driverName,
      secondaryDriverName,
      secondaryDriverId: b.secondaryDriverId,
      secondaryVehicleId: b.secondaryDriverId ? carByDriver.get(b.secondaryDriverId) ?? null : null,
      // Long-haul, assigned (car + primary), but no co-driver → parked card.
      needsCoDriver:
        longTrip && b.primaryDriverId != null && b.vehicleId != null && b.secondaryDriverId == null,
      reco,
    };
  });

  // Outsourced trips → SchedulerBooking (no car/driver/reco), grouped per row.
  const outsourcedBookings: SchedulerBooking[] = outsourcedRaw.map((b) => {
    const span = daySpan(b.startAt, b.endAt, dayStart, dayEnd);
    return {
      id: b.id,
      jobNumber: b.jobNumber,
      purpose: b.purpose,
      destination: b.destination,
      outsideChula: b.outsideChula,
      googleMapsUrl: b.googleMapsUrl,
      timeLabel: span.continuesBefore ? `↪ ${format(b.startAt, "EEE d MMM", { locale: dfLocale })}` : hm(b.startAt),
      endLabel: span.continuesAfter ? `${hm(b.endAt)} ↩ ${format(b.endAt, "EEE d MMM", { locale: dfLocale })}` : hm(b.endAt),
      departLabel: hm(b.startAt) + daySuperscript(b.startAt, dayStart),
      arriveLabel: hm(b.endAt) + daySuperscript(b.endAt, dayStart),
      startHour: span.startHour,
      endHour: span.endHour,
      continuesBefore: span.continuesBefore,
      continuesAfter: span.continuesAfter,
      vehicleId: null,
      jobType: b.jobType,
      hasDriver: false,
      driverName: null,
      secondaryDriverName: null,
      secondaryDriverId: null,
      secondaryVehicleId: null,
      needsCoDriver: false,
      reco: null,
    };
  });
  const outsourcedByRow = new Map<string, SchedulerBooking[]>();
  outsourcedRaw.forEach((b, i) => {
    const list = outsourcedByRow.get(b.adHocVehicleId!) ?? [];
    list.push(outsourcedBookings[i]!);
    outsourcedByRow.set(b.adHocVehicleId!, list);
  });
  const adHocRows = adHocRowsRaw.map((r) => ({
    id: r.id,
    label: r.label,
    cost: r.cost != null ? r.cost.toString() : null,
    bookings: outsourcedByRow.get(r.id) ?? [],
  }));

  // Overlap conflicts among already-assigned trips (the red ring): the count of
  // "loser" trips the auto-assign button will try to re-match to a free car.
  const conflictCount = findConflictLosers(
    dayBookings
      .filter((b) => b.vehicleId && b.primaryDriverId)
      .map((b) => ({
        id: b.id,
        vehicleId: b.vehicleId!,
        startAt: b.startAt,
        endAt: b.endAt,
        jobType: b.jobType,
        submittedAt: b.createdAt,
      })),
  ).size;

  const isoOf = (d: Date) => format(d, "yyyy-MM-dd");
  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
          <span className="min-w-40 text-center text-sm font-medium">
            {format(day, "EEE d MMM yyyy", { locale: dfLocale })}
          </span>
          <Link
            href={`/admin/schedule?date=${isoOf(addDays(dayStart, 1))}`}
            className={navBtn}
            aria-label={t("nextDay")}
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {draftMoves.length > 0 && (
        <DraftReviewPanel
          moves={draftMoves}
          labels={{
            title: t("draftReviewTitle"),
            summary: t("draftReviewSummary", { count: draftMoves.length }),
            apply: t("draftApply"),
            dismiss: t("draftDismiss"),
            skipped: t("draftSkipped"),
          }}
        />
      )}

      <DriverRosterControl drivers={roster} date={isoOf(dayStart)} />

      <SchedulerBoard
        vehicles={vehicleRows}
        bookings={bookings}
        dutyVehicleId={dutyVehicleId}
        conflictCount={conflictCount}
        date={isoOf(dayStart)}
        adHocRows={adHocRows}
      />
    </div>
  );
}
