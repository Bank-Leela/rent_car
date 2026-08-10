import { addDays, format } from "date-fns";
import { prisma } from "@/lib/db";
import type { SchedulerVehicle, SchedulerBooking } from "@/components/admin/scheduler-board-shared";
import type { AdHocRowData } from "@/components/admin/scheduler-board-blocks";
import { recommendForBookings } from "@/lib/booking/placement-reco-data";
import { LONG_TRIP_KM } from "@/lib/booking/classification";
import { daySpan, daySuperscript } from "@/lib/booking/day-window";
import { getTranslations } from "next-intl/server";
import { th, enUS } from "date-fns/locale";
import { tripLegs } from "@/lib/booking/trip-legs";

// Compact clock for the board's narrow blocks: drop ":00" so a 2h block fits its
// own start–end ("08:00–12:00" → "08–12"); keep the minutes only when non-zero.
const hm = (d: Date) => (d.getMinutes() === 0 ? format(d, "HH") : format(d, "HH:mm"));

/**
 * Everything the drag-and-drop timeline board needs for one day.
 *
 * Lifted verbatim out of the schedule page it used to live in, so the timeline
 * and the whiteboard rounds board can sit behind a view toggle on the same page
 * without that page carrying ~270 lines of mapping for a view it may not render.
 * The mapping itself is unchanged — this is a move, not a rewrite.
 */
export async function loadTimelineBoard(
  dayStart: Date,
  isThai: boolean,
): Promise<{
  vehicles: SchedulerVehicle[];
  bookings: SchedulerBooking[];
  dutyVehicleId: string | null;
  adHocRows: AdHocRowData[];
}> {
  const dayEnd = addDays(dayStart, 1);
  const t = await getTranslations("scheduler");
  const dfLocale = isThai ? th : enUS;
  const [vehicles, dayBookings, onCall, adHocRowsRaw, outsourcedRaw] = await Promise.all([
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
        // External charter (SMUS): outside buses/vans, shown in a dedicated row.
        externalBusCount: true,
        externalVanCount: true,
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
        id: true, purpose: true, destination: true, startAt: true, endAt: true,
        travelWithinChula: true, googleMapsUrl: true,
        vehicleId: true, jobType: true, estimatedDistance: true, createdAt: true,
        primaryDriverId: true, secondaryDriverId: true,
        primaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
        secondaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
        adHocVehicleId: true,
      },
    }),
  ]);

  // car=driver: the duty car is the on-call driver's own car — always resolvable.
  const dutyDriverId = onCall?.driverId ?? null;
  const dutyVehicleId = dutyDriverId
    ? vehicles.find((v) => v.assignedDriverId === dutyDriverId)?.id ?? null
    : null;

  // car=driver: which car each driver is assigned to, to place a co-driver ghost.
  const carByDriver = new Map<string, string>();
  for (const v of vehicles) if (v.assignedDriverId) carByDriver.set(v.assignedDriverId, v.id);
  const vehicleRows = vehicles.map((v) => {
    const du = v.assignedDriver?.user;
    const driverName = du ? (isThai ? du.thaiName ?? du.name : du.name ?? du.thaiName) ?? null : null;
    return { id: v.id, registrationNumber: v.registrationNumber, driverName };
  });


  // Placement recommendation for each unassigned (queue) booking — the same
  // suggestion the batch overflow list shows, surfaced on the board's queue.
  // External charter (SMUS) never enters the internal fleet — it's drawn in its
  // own row below, and must stay out of the queue / auto-assign / recos.
  const internalDayBookings = dayBookings.filter((b) => b.jobType !== "SMUS");
  const smusDayBookings = dayBookings.filter((b) => b.jobType === "SMUS");
  const queueRaw = internalDayBookings
    .filter((b) => !b.vehicleId)
    .map((b) => ({ id: b.id, startAt: b.startAt, endAt: b.endAt, estimatedDistance: b.estimatedDistance, jobType: b.jobType }));
  const recos = await recommendForBookings(dayStart, queueRaw, isThai);
  const dutyTag = t("duty");
  const assignReco = t("assignReco");
  const bookings = internalDayBookings.map((b) => {
    const u = b.primaryDriver?.user;
    const driverName = u ? (isThai ? u.thaiName ?? u.name : u.name ?? u.thaiName) ?? null : null;
    const su = b.secondaryDriver?.user;
    const secondaryDriverName = su ? (isThai ? su.thaiName ?? su.name : su.name ?? su.thaiName) ?? null : null;
    // Project the (possibly multi-day) trip onto this viewed day.
    // No-wait split: the primary block is clamped to leg 1; leg 2 renders as a
    // read-only return ghost. Waiting/single-interval trips → one leg, unchanged.
    const legs = tripLegs(b);
    const pStart = legs[0]!.startAt;
    const pEnd = legs[0]!.endAt;
    const span = daySpan(pStart, pEnd, dayStart, dayEnd);
    const returnLeg =
      legs.length === 2
        ? (() => {
            const rs = daySpan(legs[1]!.startAt, legs[1]!.endAt, dayStart, dayEnd);
            return {
              startHour: rs.startHour,
              endHour: rs.endHour,
              timeLabel: hm(legs[1]!.startAt),
              endLabel: hm(legs[1]!.endAt),
            };
          })()
        : null;
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
      purpose: b.purpose,
      destination: b.destination,
      travelWithinChula: b.travelWithinChula,
      googleMapsUrl: b.googleMapsUrl,
      returnLeg,
      // On its departure day a trip shows its start time; on a later (return or
      // middle) day it shows "↪ <departure date>" so it's clear it's continuing.
      // pStart/pEnd are leg 1's bounds (= the whole trip when waiting).
      timeLabel: span.continuesBefore
        ? `↪ ${format(pStart, "EEE d MMM", { locale: dfLocale })}`
        : hm(pStart),
      // Ending the same day → just the time; ending a later day → the return time
      // plus the return date ("↩ <date>").
      endLabel: span.continuesAfter
        ? `${hm(pEnd)} ↩ ${format(pEnd, "EEE d MMM", { locale: dfLocale })}`
        : hm(pEnd),
      // Airline-style depart/arrive for the both-ends multi-day rendering: time +
      // a day-offset marker relative to the viewed day ("18:00⁺1" = next day).
      departLabel: hm(pStart) + daySuperscript(pStart, dayStart),
      arriveLabel: hm(pEnd) + daySuperscript(pEnd, dayStart),
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
      purpose: b.purpose,
      destination: b.destination,
      travelWithinChula: b.travelWithinChula,
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

  // External charter (SMUS — "หลักสูตรนิสิตแพทย์"): outside buses/vans the
  // requester arranges directly. They never touch the internal fleet, so they
  // ride in their own synthetic outside-row (reusing the board's adHoc-row
  // rendering). The bus/van counts are folded into the purpose line since the
  // board has no dedicated field for them.
  const smusBookings: SchedulerBooking[] = smusDayBookings.map((b) => {
    const span = daySpan(b.startAt, b.endAt, dayStart, dayEnd);
    const counts = [
      b.externalBusCount ? t("busCount", { count: b.externalBusCount }) : null,
      b.externalVanCount ? t("vanCount", { count: b.externalVanCount }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: b.id,
      purpose: counts ? `${b.purpose} · ${counts}` : b.purpose,
      destination: b.destination,
      travelWithinChula: b.travelWithinChula,
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
  if (smusBookings.length > 0) {
    adHocRows.push({
      id: "__smus__",
      label: t("externalRow"),
      cost: null,
      bookings: smusBookings,
    });
  }

  return { vehicles: vehicleRows, bookings, dutyVehicleId, adHocRows };
}
