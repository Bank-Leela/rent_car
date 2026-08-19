import { startOfDay } from "date-fns";
import type { JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadWeightedEarnings } from "@/lib/booking/earnings";
import { LONG_TRIP_KM } from "@/lib/booking/classification";
import { recommendPlacement, type Placement, type RecoDriver } from "@/lib/booking/placement-reco";

/**
 * Compute a placement recommendation for each given booking on `date` (the
 * fairest free non-duty car, or the duty car as a reclaim fallback). Server-side
 * builder for recommendPlacement — used by the batch overflow list and the
 * schedule board queue.
 */
export async function recommendForBookings(
  date: Date,
  bookings: Array<{
    id: string;
    startAt: Date;
    endAt: Date;
    estimatedDistance: number | null;
    /**
     * The manual "this trip needs two drivers" flag. Required, not optional: it
     * was simply absent here while every other pairing site
     * (matching.ts, batch-solver.ts, tjw-request-solver.ts, leave-core.ts) ORs
     * it with the distance — and since Google Maps is env-gated,
     * `estimatedDistance` is usually null in production, which makes this flag
     * the ONLY trigger that fires. A required field means the next caller
     * cannot forget it the way these three did.
     */
    needsSecondaryDriver: boolean;
    /** Requested category — the reco prefers a matching car, then falls back. */
    preferredVehicleType?: string | null;
    jobType: JobType;
  }>,
  isThai: boolean,
): Promise<Map<string, Placement>> {
  if (bookings.length === 0) return new Map();
  const dayStart = startOfDay(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const drivers = await prisma.driver.findMany({
    // A deactivated user must drop out of every pick pool — Driver.isActive is
    // never toggled, so gate on the owning User's isActive too (remove a driver).
    // Also skip anyone marked off for the day (sick / leave).
    where: {
      isActive: true,
      user: { is: { isActive: true } },
      unavailabilities: { none: { date: dayStart } },
    },
    select: {
      id: true,
      lastAssignedAt: true,
      user: { select: { name: true, thaiName: true } },
      assignedVehicle: { select: { id: true, registrationNumber: true, type: true } },
    },
  });
  const onCall = await prisma.onCallShift.findUnique({ where: { date: dayStart }, select: { driverId: true } });
  // An OnCallShift can point at a driver who was since deactivated — that's a
  // ghost not in the active pool. Drop it so WERN falls back to the duty rotation.
  const dutyDriverId =
    onCall?.driverId && drivers.some((d) => d.id === onCall.driverId) ? onCall.driverId : null;
  const earnings = await loadWeightedEarnings(drivers.map((d) => d.id));

  // Each driver's committed trips that day (primary or secondary), for overlap.
  // Includes APPROVED so the reco never proposes a car that reassignVehicleAction
  // (which blocks on APPROVED|ASSIGNED) would then reject as vehicleBusy.
  const assigned = await prisma.booking.findMany({
    where: {
      status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
      primaryDriverId: { not: null },
      startAt: { lt: dayEnd },
      endAt: { gt: dayStart },
    },
    select: { startAt: true, endAt: true, jobType: true, primaryDriverId: true, secondaryDriverId: true },
  });
  const tripsByDriver = new Map<string, Array<{ startAt: Date; endAt: Date; jobType: JobType }>>();
  const addTrip = (id: string | null, t: { startAt: Date; endAt: Date; jobType: JobType }) => {
    if (!id) return;
    const list = tripsByDriver.get(id) ?? [];
    list.push({ startAt: t.startAt, endAt: t.endAt, jobType: t.jobType });
    tripsByDriver.set(id, list);
  };
  for (const a of assigned) {
    addTrip(a.primaryDriverId, a);
    addTrip(a.secondaryDriverId, a);
  }

  const recoDrivers: RecoDriver[] = drivers.map((d) => {
    const u = d.user;
    const driverName = u ? (isThai ? u.thaiName ?? u.name : u.name ?? u.thaiName) ?? null : null;
    return {
      driverId: d.id,
      vehicleId: d.assignedVehicle?.id ?? null,
      vehicleType: d.assignedVehicle?.type ?? null,
      registrationNumber: d.assignedVehicle?.registrationNumber ?? null,
      driverName,
      earningsScore: earnings.get(d.id) ?? 0,
      lastAssignedAt: d.lastAssignedAt,
      trips: tripsByDriver.get(d.id) ?? [],
    };
  });

  const out = new Map<string, Placement>();
  for (const b of bookings) {
    out.set(
      b.id,
      recommendPlacement({
        booking: {
          startAt: b.startAt,
          endAt: b.endAt,
          jobType: b.jobType,
          preferredVehicleType: b.preferredVehicleType,
        },
        needsSecondary: b.needsSecondaryDriver || (b.estimatedDistance ?? 0) > LONG_TRIP_KM,
        dutyDriverId,
        drivers: recoDrivers,
      }),
    );
  }
  return out;
}
