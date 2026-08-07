import { endOfDay, startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { logTransition } from "@/lib/booking/audit";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";
import { pickAutoDutyDriver } from "@/lib/booking/duty-assignment";
import { canTakeTrip } from "@/lib/booking/driver-capacity";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";

/**
 * One day of leave for one driver, and everything that has to follow from it.
 *
 * Marking leave is not just a row in a table — three other things are true the
 * moment a driver is away, and each used to be somebody's job to remember:
 *
 *  1. If they were rostered as that day's เวร, the day now has no duty driver.
 *  2. Their assigned trips that day need somebody else.
 *  3. Their rotation standing should not credit work they did not do.
 *
 * Returns what actually happened so the caller can report it rather than
 * claiming success blindly.
 */
export type LeaveDayOutcome = {
  date: Date;
  /** เวร was re-rostered away from this driver (null = they were not on duty). */
  rerosteredTo: string | null;
  /** Trips moved onto the เวร driver's car. */
  handedOff: string[];
  /** Trips nothing could take — left APPROVED for the day's overflow bar. */
  released: string[];
};

/** Local midnight for a "yyyy-MM-dd", matching the @db.Date write/read path. */
export function dayMidnight(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Every calendar day in [from, to], inclusive. Empty if the range is inverted. */
export function daysInRange(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const cur = startOfDay(from);
  const last = startOfDay(to);
  // Bounded so a typo'd year cannot enumerate a decade of rows in one request.
  for (let i = 0; cur <= last && i < 366; i += 1) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Hand one booking to the day's เวร driver, or report that nobody can take it.
 *
 * The agreed rule is that a leaving driver's work goes to the เวร driver, who
 * is on campus and closest to being able to absorb it. That deliberately
 * overrides the "duty driver is reserved all day" rule for this case only —
 * being reserved is what makes them the right person to catch a dropped job.
 *
 * It is still not unconditional: the เวร driver may already be committed at
 * that hour, and double-booking a car is the one rule nothing may break. When
 * they cannot take it, the trip drops to APPROVED with no driver so it surfaces
 * in that day's overflow bar for P'Top to place by hand.
 */
async function handOffToDuty(
  bookingId: string,
  dutyDriverId: string | null,
  adminId: string,
  reason: string | null,
): Promise<"handedOff" | "released"> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true, jobType: true, startAt: true, endAt: true, primaryDriverId: true, secondaryDriverId: true },
  });
  if (!booking) return "released";

  let target: { driverId: string; vehicleId: string } | null = null;
  if (dutyDriverId) {
    const duty = await prisma.driver.findUnique({
      where: { id: dutyDriverId },
      select: { id: true, isActive: true, assignedVehicle: { select: { id: true, isActive: true } } },
    });
    if (duty?.isActive && duty.assignedVehicle?.isActive) {
      // Their existing commitments that day, so we never hand them an overlap.
      const existing = await prisma.booking.findMany({
        where: {
          status: { in: COMMITTED_STATUSES },
          id: { not: bookingId },
          startAt: { lt: endOfDay(booking.startAt) },
          endAt: { gt: startOfDay(booking.startAt) },
          OR: [{ primaryDriverId: duty.id }, { secondaryDriverId: duty.id }],
        },
        select: { startAt: true, endAt: true, jobType: true, waitAtDestination: true, dropOffDone: true, pickupReturnTime: true },
      });
      const fits = canTakeTrip(
        { startAt: booking.startAt, endAt: booking.endAt, jobType: booking.jobType },
        existing,
      );
      if (fits) target = { driverId: duty.id, vehicleId: duty.assignedVehicle.id };
    }
  }

  const freed = [booking.primaryDriverId, booking.secondaryDriverId].filter((x): x is string => !!x);

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: target
        ? {
            vehicleId: target.vehicleId,
            primaryDriverId: target.driverId,
            secondaryDriverId: null,
            status: "ASSIGNED",
          }
        : {
            vehicleId: null,
            primaryDriverId: null,
            secondaryDriverId: null,
            status: "APPROVED",
            driverScheduleStatus: "UNCLAIMED",
            decidedAt: null,
          },
    });
    await logTransition({
      bookingId,
      actorUserId: adminId,
      fromStatus: booking.status,
      toStatus: target ? "ASSIGNED" : "APPROVED",
      action: target ? "DRIVER_OFF_HANDOFF_WERN" : "DRIVER_OFF_RELEASE",
      metadata: { reason, freedDrivers: freed, ...(target ? { toDriverId: target.driverId } : {}) },
      tx,
    });
  });

  for (const id of freed) await recomputeRotationStamp(id, booking.jobType);
  if (target) await recomputeRotationStamp(target.driverId, booking.jobType);
  return target ? "handedOff" : "released";
}

/**
 * Record one day of leave and settle its consequences. Idempotent: re-marking a
 * day already marked re-checks the เวร roster and the trips rather than failing.
 */
export async function applyLeaveDay(
  driverId: string,
  date: Date,
  adminId: string,
  reason: string | null,
): Promise<LeaveDayOutcome> {
  const day = startOfDay(date);
  await prisma.driverUnavailability.upsert({
    where: { driverId_date: { driverId, date: day } },
    create: { driverId, date: day, reason },
    update: { reason },
  });

  // 1. เวร. The roster writes days far ahead and never rewrites a decided one,
  //    so leave recorded afterwards would otherwise leave this driver showing as
  //    both on duty and on leave. Drop the shift and let the rotation refill it
  //    with the next fairest present driver — exactly what it would have chosen
  //    had the leave been known first.
  const shift = await prisma.onCallShift.findUnique({ where: { date: day }, select: { driverId: true } });
  let rerosteredTo: string | null = null;
  if (shift?.driverId === driverId) {
    // Re-pick THIS day directly rather than deferring to ensureOnCallRosterThrough:
    // that function tops the roster up from the last rostered day forward, so for
    // a day in the middle of an already-written roster it no-ops and the day is
    // simply left unmanned. (Found by testing a 5-day range: 5 shifts before,
    // 4 after.)
    const pool = await prisma.driver.findMany({
      where: { isActive: true, user: { is: { isActive: true } }, id: { not: driverId } },
      select: {
        id: true,
        onCallShifts: { where: { date: { lt: day } }, orderBy: { date: "desc" }, take: 1, select: { date: true } },
        unavailabilities: { where: { date: day }, select: { id: true } },
      },
    });
    // Anyone else off that day, or away on a multi-day ตจว, cannot hold เวร either.
    const away = new Set<string>(pool.filter((d) => d.unavailabilities.length > 0).map((d) => d.id));
    const spanning = await prisma.booking.findMany({
      where: {
        jobType: "TJW",
        status: { in: COMMITTED_STATUSES },
        startAt: { lt: endOfDay(day) },
        endAt: { gt: day },
      },
      select: { primaryDriverId: true, secondaryDriverId: true },
    });
    for (const t of spanning) {
      if (t.primaryDriverId) away.add(t.primaryDriverId);
      if (t.secondaryDriverId) away.add(t.secondaryDriverId);
    }

    const chosen = pickAutoDutyDriver(
      pool.map((d) => ({ driverId: d.id, lastOnCallAt: d.onCallShifts[0]?.date ?? null })),
      away,
    );
    if (chosen) {
      await prisma.onCallShift.update({ where: { date: day }, data: { driverId: chosen } });
      rerosteredTo = chosen;
    } else {
      // Nobody at all can cover — better an empty day P'Top can see than one
      // showing a driver who is on leave.
      await prisma.onCallShift.delete({ where: { date: day } });
    }
  }

  // 2. Their trips that day. Read the duty driver AFTER the re-roster above, or
  //    we would hand the work straight back to the person going on leave.
  const duty = await prisma.onCallShift.findUnique({ where: { date: day }, select: { driverId: true } });
  const affected = await prisma.booking.findMany({
    where: {
      status: { in: ["APPROVED", "ASSIGNED"] },
      startAt: { gte: day, lte: endOfDay(day) },
      endAt: { gte: new Date() }, // a trip already finished stays as it was
      OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
    },
    select: { id: true },
  });

  const handedOff: string[] = [];
  const released: string[] = [];
  for (const b of affected) {
    const outcome = await handOffToDuty(b.id, duty?.driverId ?? null, adminId, reason);
    (outcome === "handedOff" ? handedOff : released).push(b.id);
  }

  return { date: day, rerosteredTo, handedOff, released };
}

/** Clear one day of leave. The trips it moved are NOT moved back — they belong
 *  to whoever holds them now, and unwinding could double-book that person. */
export async function clearLeaveDay(driverId: string, date: Date): Promise<void> {
  await prisma.driverUnavailability.deleteMany({ where: { driverId, date: startOfDay(date) } });
}
