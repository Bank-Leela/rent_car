import { startOfDay } from "date-fns";
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
  bookings: Array<{ id: string; startAt: Date; endAt: Date; estimatedDistance: number | null }>,
  isThai: boolean,
): Promise<Map<string, Placement>> {
  if (bookings.length === 0) return new Map();
  const dayStart = startOfDay(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    select: {
      id: true,
      lastAssignedAt: true,
      user: { select: { name: true, thaiName: true } },
      assignedVehicle: { select: { id: true, registrationNumber: true } },
    },
  });
  const onCall = await prisma.onCallShift.findUnique({ where: { date: dayStart }, select: { driverId: true } });
  const dutyDriverId = onCall?.driverId ?? null;
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
    select: { startAt: true, endAt: true, primaryDriverId: true, secondaryDriverId: true },
  });
  const tripsByDriver = new Map<string, Array<{ startAt: Date; endAt: Date }>>();
  const addTrip = (id: string | null, t: { startAt: Date; endAt: Date }) => {
    if (!id) return;
    const list = tripsByDriver.get(id) ?? [];
    list.push({ startAt: t.startAt, endAt: t.endAt });
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
        booking: { startAt: b.startAt, endAt: b.endAt },
        needsSecondary: (b.estimatedDistance ?? 0) > LONG_TRIP_KM,
        dutyDriverId,
        drivers: recoDrivers,
      }),
    );
  }
  return out;
}
