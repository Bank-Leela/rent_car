import { subDays } from "date-fns";
import { prisma } from "@/lib/db";
import {
  findBufferConflicts,
  shouldWarnAboutCancellations,
  isWithinWorkHours,
  checkLeadTime,
  TWO_DRIVER_DISTANCE_KM,
} from "@/lib/booking/rules";
import { SLOT_HOLDING_STATUSES, dayCapacity, dayWindow } from "@/lib/booking/slot-capacity";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";

// Derived data for the admin booking-detail page: assignable-vehicle list with
// per-car buffer-conflict flags, the repeat-canceller warning, and (only when an
// approval decision is pending) the decision-context supply/risk snapshot.
// Extracted from the page so the page stays a thin view over this logic.

export type DecisionFlag = "emergency" | "outOfHours" | "shortLead" | "twoDrivers";

export type DetailVehicleOption = {
  id: string;
  registrationNumber: string;
  type: string;
  capacity: number;
  isDutyVehicle: boolean;
  conflict: boolean;
};

export type DecisionContext = {
  dayUsed: number;
  dayCapacity: number;
  freeCars: string[];
  totalCars: number;
  flags: DecisionFlag[];
};

export type BookingDetailContext = {
  vehicleOptions: DetailVehicleOption[];
  cancellationWarning: boolean;
  cancellationCount: number;
  decisionContext: DecisionContext | null;
};

type DetailBooking = {
  id: string;
  requesterId: string;
  startAt: Date;
  endAt: Date;
  province: string;
  isEmergency: boolean;
  estimatedDistance: number | null;
};

export async function loadBookingDetailContext(
  booking: DetailBooking,
  showApproverForms: boolean,
): Promise<BookingDetailContext> {
  const [vehicles, otherBookingsByVehicle, recentCancellations] = await Promise.all([
    prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { registrationNumber: "asc" } }),
    // COMMITTED_STATUSES so the greyed-out cars in the picker match what the
    // database will actually accept. With COMPLETED missing, a car whose only
    // clash was a finished trip rendered as free and enabled, and choosing it
    // failed on the occupancy EXCLUDE.
    prisma.booking.findMany({
      where: {
        status: { in: COMMITTED_STATUSES },
        id: { not: booking.id },
        vehicleId: { not: null },
      },
      select: { id: true, vehicleId: true, startAt: true, endAt: true },
    }),
    prisma.cancellation.count({
      where: {
        booking: { requesterId: booking.requesterId },
        cancelledAt: { gte: subDays(new Date(), 90) },
      },
    }),
  ]);

  const conflictsByVehicle = new Map<string, number>();
  for (const v of vehicles) {
    const others = otherBookingsByVehicle.filter((o) => o.vehicleId === v.id);
    const conflicts = findBufferConflicts({ startAt: booking.startAt, endAt: booking.endAt }, others);
    conflictsByVehicle.set(v.id, conflicts.length);
  }

  const vehicleOptions: DetailVehicleOption[] = vehicles.map((v) => ({
    id: v.id,
    registrationNumber: v.registrationNumber,
    type: v.type,
    capacity: v.capacity,
    isDutyVehicle: v.isDutyVehicle,
    conflict: (conflictsByVehicle.get(v.id) ?? 0) > 0,
  }));

  let decisionContext: DecisionContext | null = null;
  if (showApproverForms) {
    const { start, end } = dayWindow(booking.startAt);
    const dayUsed = await prisma.booking.count({
      where: { status: { in: SLOT_HOLDING_STATUSES }, startAt: { gte: start, lt: end } },
    });
    // Capacity counts only DISPATCHABLE cars (paired to an active driver),
    // matching the submit-time gate; freeCars/totalCars below stay all-active.
    const dispatchable = await prisma.vehicle.findMany({
      where: {
        isActive: true,
        assignedDriver: { is: { isActive: true, user: { is: { isActive: true } } } },
      },
      select: { isDutyVehicle: true },
    });
    const cap = dayCapacity(
      dispatchable.filter((v) => !v.isDutyVehicle).length,
      dispatchable.filter((v) => v.isDutyVehicle).length,
    );
    const freeCars = vehicles
      .filter((v) => (conflictsByVehicle.get(v.id) ?? 0) === 0)
      .map((v) => v.registrationNumber);
    const flags: DecisionFlag[] = [];
    if (booking.isEmergency) flags.push("emergency");
    if (!isWithinWorkHours({ startAt: booking.startAt, endAt: booking.endAt })) flags.push("outOfHours");
    if (!checkLeadTime({ startAt: booking.startAt, province: booking.province, now: new Date() }).ok) {
      flags.push("shortLead");
    }
    if (typeof booking.estimatedDistance === "number" && booking.estimatedDistance > TWO_DRIVER_DISTANCE_KM) {
      flags.push("twoDrivers");
    }
    decisionContext = { dayUsed, dayCapacity: cap, freeCars, totalCars: vehicles.length, flags };
  }

  return {
    vehicleOptions,
    cancellationWarning: shouldWarnAboutCancellations(recentCancellations),
    cancellationCount: recentCancellations,
    decisionContext,
  };
}
