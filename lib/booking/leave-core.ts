import { endOfDay, startOfDay } from "date-fns";
import type { JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logEvent, logTransition } from "@/lib/booking/audit";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";
import { pickAutoDutyDriver } from "@/lib/booking/duty-assignment";
import { canTakeTrip } from "@/lib/booking/driver-capacity";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";
import { LONG_TRIP_KM } from "@/lib/booking/classification";

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
  /** Trips where they were only the co-driver, and a replacement was found. */
  coDriverReplaced: string[];
  /** Same, but nobody could take the seat — a >400 km trip now short a driver. */
  coDriverLost: string[];
  /**
   * Trips the system must not silently re-dispatch: one that started on an
   * earlier day (a multi-day ตจว whose car is already out of province) or one
   * already departed. Flagged for P'Top, left exactly as they are.
   */
  needsReview: string[];
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

type HandOffOutcome = "handedOff" | "released" | "coDriverReplaced" | "coDriverLost";

/** Can this driver absorb the trip without colliding with what they already hold? */
async function dutyCanAbsorb(
  dutyDriverId: string,
  booking: { id: string; jobType: JobType; startAt: Date; endAt: Date },
): Promise<boolean> {
  const existing = await prisma.booking.findMany({
    where: {
      status: { in: COMMITTED_STATUSES },
      id: { not: booking.id },
      startAt: { lt: endOfDay(booking.startAt) },
      endAt: { gt: startOfDay(booking.startAt) },
      OR: [{ primaryDriverId: dutyDriverId }, { secondaryDriverId: dutyDriverId }],
    },
    select: { startAt: true, endAt: true, jobType: true, waitAtDestination: true, dropOffDone: true, pickupReturnTime: true },
  });
  return canTakeTrip(
    { startAt: booking.startAt, endAt: booking.endAt, jobType: booking.jobType },
    existing,
  );
}

/**
 * Hand one booking off because the driver who held it is away, or report that
 * nobody can take it.
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
 *
 * WHICH SEAT the away driver held decides what moves. This used to be ignored:
 * the write set `primaryDriverId = เวร, secondaryDriverId = null` whatever the
 * away driver's role, so marking the CO-DRIVER of a >400 km trip sick threw the
 * primary off their own trip and handed it to the เวร driver solo — silently
 * dropping the second driver that the >400 km rule exists to require.
 */
async function handOffToDuty(
  bookingId: string,
  awayDriverId: string,
  dutyDriverId: string | null,
  adminId: string,
  reason: string | null,
): Promise<HandOffOutcome> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, status: true, jobType: true, startAt: true, endAt: true,
      primaryDriverId: true, secondaryDriverId: true,
      needsSecondaryDriver: true, estimatedDistance: true,
    },
  });
  if (!booking) return "released";

  // ── The away driver was only riding as CO-DRIVER ──────────────────────────
  // The primary still has the car and can still drive: the trip itself is not
  // in trouble, only its second seat. Touch nothing but that seat.
  if (booking.primaryDriverId && booking.primaryDriverId !== awayDriverId) {
    const needsCoDriver =
      booking.needsSecondaryDriver || (booking.estimatedDistance ?? 0) > LONG_TRIP_KM;

    // Same catcher rule as a primary hand-off — the เวร driver first. A
    // co-driver rides in the primary's car, so unlike a primary they need no car
    // of their own; they must only be a real, present, non-colliding body.
    let replacement: string | null = null;
    if (dutyDriverId && dutyDriverId !== booking.primaryDriverId) {
      const duty = await prisma.driver.findUnique({
        where: { id: dutyDriverId },
        select: { id: true, isActive: true, user: { select: { isActive: true } } },
      });
      if (duty?.isActive && duty.user?.isActive && (await dutyCanAbsorb(duty.id, booking))) {
        replacement = duty.id;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          secondaryDriverId: replacement,
          // A trip that still REQUIRES a second driver and no longer has one is
          // not dispatchable as it stands; flag it so it cannot sit on the board
          // looking healthy. A co-driver added by hand on a short trip carries no
          // requirement, so losing it flags nothing.
          ...(needsCoDriver && !replacement ? { overflowReason: "NO_SECONDARY_DRIVER" as const } : {}),
        },
      });
      await logTransition({
        bookingId,
        actorUserId: adminId,
        fromStatus: booking.status,
        toStatus: booking.status,
        action: replacement ? "DRIVER_OFF_CODRIVER_REPLACED" : "DRIVER_OFF_CODRIVER_LOST",
        metadata: {
          reason,
          awayDriverId,
          keptPrimaryDriverId: booking.primaryDriverId,
          ...(replacement ? { toDriverId: replacement } : { needsCoDriver }),
        },
        tx,
      });
    });

    await recomputeRotationStamp(awayDriverId, booking.jobType);
    if (replacement) await recomputeRotationStamp(replacement, booking.jobType);
    return replacement ? "coDriverReplaced" : "coDriverLost";
  }

  // ── The away driver was the PRIMARY — the whole trip needs a new car ───────
  let target: { driverId: string; vehicleId: string } | null = null;
  if (dutyDriverId) {
    const duty = await prisma.driver.findUnique({
      where: { id: dutyDriverId },
      select: { id: true, isActive: true, assignedVehicle: { select: { id: true, isActive: true } } },
    });
    if (duty?.isActive && duty.assignedVehicle?.isActive && (await dutyCanAbsorb(duty.id, booking))) {
      target = { driverId: duty.id, vehicleId: duty.assignedVehicle.id };
    }
  }

  // Keep the existing co-driver across the move — they are still free (the trip
  // window has not changed) and a >400 km trip still needs them. Drop them only
  // when they ARE the receiving driver, who cannot fill both seats.
  const keptSecondary =
    target && booking.secondaryDriverId && booking.secondaryDriverId !== target.driverId
      ? booking.secondaryDriverId
      : null;
  const freed = [awayDriverId, booking.secondaryDriverId]
    .filter((x): x is string => !!x && x !== keptSecondary);

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: target
        ? {
            vehicleId: target.vehicleId,
            primaryDriverId: target.driverId,
            secondaryDriverId: keptSecondary,
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
      metadata: {
        reason,
        freedDrivers: freed,
        ...(target ? { toDriverId: target.driverId, keptCoDriverId: keptSecondary } : {}),
      },
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
  //
  //    OVERLAP, not "starts that day": the old `startAt` window could not see a
  //    multi-day ตจว that began on an earlier day and runs through this one, so
  //    a driver marked off mid-trip kept the trip and nothing said so.
  const duty = await prisma.onCallShift.findUnique({ where: { date: day }, select: { driverId: true } });
  const affected = await prisma.booking.findMany({
    where: {
      status: { in: ["APPROVED", "ASSIGNED"] },
      startAt: { lt: endOfDay(day) },
      endAt: { gt: day },
      OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
    },
    select: { id: true, startAt: true, endAt: true, trip: { select: { startedAt: true, endedAt: true } } },
  });

  const now = new Date();
  const handedOff: string[] = [];
  const released: string[] = [];
  const coDriverReplaced: string[] = [];
  const coDriverLost: string[] = [];
  const needsReview: string[] = [];

  for (const b of affected) {
    // Already over — the work was done, nothing to move.
    if (b.endAt <= now || b.trip?.endedAt) continue;

    // Two kinds the system must not re-dispatch on its own. Started on an
    // earlier day: a multi-day ตจว whose car is already out of province, so
    // handing tomorrow's leg to the on-campus เวร driver is nonsense. Already
    // departed: the car has left, whatever the roster now says. Both keep their
    // driver and get flagged for P'Top instead.
    if (b.startAt < day || b.startAt <= now || b.trip?.startedAt) {
      needsReview.push(b.id);
      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: b.id },
          data: { overflowReason: "DRIVER_OFF_NEEDS_REVIEW" },
        });
        await logTransition({
          bookingId: b.id,
          actorUserId: adminId,
          fromStatus: null,
          toStatus: null,
          action: "DRIVER_OFF_NEEDS_REVIEW",
          metadata: {
            reason,
            awayDriverId: driverId,
            why: b.startAt < day ? "startedOnEarlierDay" : "alreadyDeparted",
          },
          tx,
        });
      });
      continue;
    }

    const outcome = await handOffToDuty(b.id, driverId, duty?.driverId ?? null, adminId, reason);
    if (outcome === "handedOff") handedOff.push(b.id);
    else if (outcome === "released") released.push(b.id);
    else if (outcome === "coDriverReplaced") coDriverReplaced.push(b.id);
    else coDriverLost.push(b.id);
  }

  // 3. The decision itself. Only its consequences were ever recorded, so "who
  //    marked this driver off, and when" had no answer anywhere.
  await logEvent({
    actorUserId: adminId,
    entityType: "DRIVER",
    entityId: driverId,
    action: "DRIVER_LEAVE_SET",
    metadata: {
      date: day.toISOString(),
      reason,
      rerosteredTo,
      handedOff: handedOff.length,
      released: released.length,
      coDriverReplaced: coDriverReplaced.length,
      coDriverLost: coDriverLost.length,
      needsReview: needsReview.length,
    },
  });

  return { date: day, rerosteredTo, handedOff, released, coDriverReplaced, coDriverLost, needsReview };
}

/** Clear one day of leave. The trips it moved are NOT moved back — they belong
 *  to whoever holds them now, and unwinding could double-book that person.
 *
 *  The one thing that IS undone is the review flag: a trip was only flagged
 *  because its driver was away, so if they are not away it has nothing to
 *  review. Trips flagged for any other reason are left alone. */
export async function clearLeaveDay(driverId: string, date: Date, adminId: string): Promise<void> {
  const day = startOfDay(date);
  const { count } = await prisma.driverUnavailability.deleteMany({ where: { driverId, date: day } });
  if (count === 0) return; // nothing was marked — no flag of ours to clear, nothing to log

  await prisma.booking.updateMany({
    where: {
      overflowReason: "DRIVER_OFF_NEEDS_REVIEW",
      startAt: { lt: endOfDay(day) },
      endAt: { gt: day },
      OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
    },
    data: { overflowReason: null },
  });

  await logEvent({
    actorUserId: adminId,
    entityType: "DRIVER",
    entityId: driverId,
    action: "DRIVER_LEAVE_CLEARED",
    metadata: { date: day.toISOString() },
  });
}
