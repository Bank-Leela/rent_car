import { format, startOfDay, subDays } from "date-fns";
import type { JobType, PreferredVehicleType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadWeightedEarnings } from "@/lib/booking/earnings";
import { recommendOvertimePlacement } from "@/lib/booking/overtime-reco";
import { dayHasRoomForMany } from "@/lib/booking/approval-capacity";
import { triageFlags, waitingHours, SLA_WARN_HOURS, type TriageFlag } from "@/lib/booking/triage";
import { dbDateKey, driverDayKey } from "@/lib/booking/db-date";

// Derived signals for the admin queue: overtime-placement recommendations for
// over-capacity WAITLIST bookings, per-booking triage flags, and the SLA-overdue
// count. Extracted from admin/page.tsx so the page stays a thin view. Pure
// orchestration over the existing reco/triage rule helpers — no rule change.

export type OvertimeReco = { name: string; reg: string; time: string; vehicleId: string };

type QueueBooking = {
  id: string;
  status: string;
  startAt: Date;
  endAt: Date;
  requesterId: string;
  province: string;
  isEmergency: boolean;
  createdAt: Date;
  // Needed by the capacity check: jobType and these two decide whether the
  // question even applies (WERN/TJW/SMUS/เร่งด่วน/outsourced bus never go
  // through จัด), and the distance decides whether a co-driver is required.
  jobType: JobType;
  preferredVehicleType: PreferredVehicleType | null;
  estimatedDistance: number | null;
  // Part of the same question: a day with a free car but no second driver cannot
  // serve a trip that needs two, and the flag is what says so when Maps (which
  // is env-gated) left estimatedDistance null.
  needsSecondaryDriver: boolean;
};

type QueueDriver = {
  id: string;
  lastAssignedAt: Date | null;
  user: { name: string | null; email: string | null };
};

export type QueueContext = {
  overtimeReco: Map<string, OvertimeReco>;
  triageByBooking: Map<string, TriageFlag[]>;
  slaOverdue: number;
};

export async function loadQueueContext(opts: {
  pending: QueueBooking[];
  allDrivers: QueueDriver[];
  now: Date;
}): Promise<QueueContext> {
  const { pending, allDrivers, now } = opts;
  const overtimeReco = new Map<string, OvertimeReco>();
  const triageByBooking = new Map<string, TriageFlag[]>();
  let slaOverdue = 0;

  // --- Overtime placement recommendations for over-capacity WAITLIST bookings. ---
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
      prisma.driverUnavailability.findMany({
        where: { date: { gte: rangeStart, lt: rangeEnd } },
        select: { driverId: true, date: true },
      }),
    ]);
    // Keyed with driverDayKey, not format(u.date, …). The old key was built from
    // the value Prisma returns for a @db.Date, which is the stored date — a day
    // off from the day the leave is about — while the lookup below was built from
    // a LOCAL midnight. The two never matched, so this filter excluded nobody and
    // the OT recommendation could name a driver who is on sick leave. The OT
    // assign path deliberately skips the leave check, so it was one click to
    // commit. (The old comment claimed this was "TZ-robust"; it was the opposite.)
    const offByDay = new Set(unavailRows.map((u) => driverDayKey(u.driverId, u.date)));
    const driverName = new Map(allDrivers.map((d) => [d.id, d.user.name ?? d.user.email ?? d.id]));
    const vehicleReg = new Map(vehicles.map((v) => [v.id, v.registrationNumber]));
    // Same shift, same consequence: keyed off the read-back value this map was
    // never hit, so every OT reco was computed with dutyDriverId null — the duty
    // car offered as if free, on top of its own duty day.
    const dutyByDay = new Map(shifts.map((s) => [dbDateKey(s.date), s.driverId]));
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
      // Both lookups go through the same keying as the maps above, so a stored
      // row and the day being asked about agree.
      const reco = recommendOvertimePlacement({
        booking: { startAt: b.startAt, endAt: b.endAt },
        dutyDriverId: dutyByDay.get(dbDateKey(dayStart)) ?? null,
        drivers: allDrivers
          .filter((d) => !offByDay.has(driverDayKey(d.id, dayStart)))
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
          vehicleId: reco.vehicleId,
        });
      }
    }
  }

  // --- Triage signals for the pending queue + SLA-overdue count. ---
  if (pending.length > 0) {
    const requesterIds = [...new Set(pending.map((b) => b.requesterId))];

    // The capacity signal is the placement engine, not a slot count — the same
    // question the approve button asks, so the chip can never contradict it.
    // Batched by day (see dayHasRoomForMany), so this is one round of queries per
    // distinct day on the queue rather than one per card.
    const [capacity, cancellations] = await Promise.all([
      dayHasRoomForMany(pending),
      prisma.cancellation.findMany({
        where: { booking: { requesterId: { in: requesterIds } }, cancelledAt: { gte: subDays(now, 90) } },
        select: { booking: { select: { requesterId: true } } },
      }),
    ]);

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
          fleetFull: (() => {
            const v = capacity.get(b.id);
            return !!v && v.gated && !v.fits;
          })(),
          cancellations: cancelByRequester.get(b.requesterId) ?? 0,
        }),
      );
      if (waitingHours(b.createdAt, now) >= SLA_WARN_HOURS) slaOverdue++;
    }
  }

  return { overtimeReco, triageByBooking, slaOverdue };
}
