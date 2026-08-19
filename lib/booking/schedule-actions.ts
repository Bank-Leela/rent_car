"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { recomputeRotationStamp, stampRotationForward } from "@/lib/booking/rotation-stamp";
import { legsOverlap, type LegSource } from "@/lib/booking/trip-legs";
import { isExclusionViolation } from "@/lib/booking/db-errors";
import { COMMITTED_STATUSES, DISPATCHABLE_STATUSES } from "@/lib/booking/booking-status";
import { sharesCarWith } from "@/lib/booking/rotations";
import { LONG_TRIP_KM } from "@/lib/booking/classification";
import { bookingDetailInclude } from "@/lib/booking/booking-detail-include";
import { sendEmail } from "@/lib/email/client";
import { requesterTimeChangedEmail } from "@/lib/email/templates";

// Adapt a booking row to the leg helper (no-wait trips free their middle).
type LegRow = { startAt: Date; endAt: Date; waitAtDestination: boolean; dropOffDone: Date | null; pickupReturnTime: string | null };
const toLegSrc = (b: LegRow): LegSource => ({
  startAt: b.startAt,
  endAt: b.endAt,
  waitAtDestination: b.waitAtDestination,
  dropOffDone: b.dropOffDone,
  pickupReturnTime: b.pickupReturnTime,
});

// car=driver: dropping a booking on a car assigns the car AND its assigned
// driver. Blocks only if the car is already booked at that time, or the car has
// no assigned driver. The board maps the error code to a message.
// On a `vehicleBusy` block, the conflicting trip(s) ride back so the board can
// name them — vital for a multi-day trip whose clash is on a day not on screen.
// A trip is named to the dispatcher by where it goes plus its hours.
export type ReassignConflict = { destination: string; startAt: Date; endAt: Date };
type ReassignResult =
  | { ok: false; error: string; conflicts?: ReassignConflict[] }
  | { ok: true };

export async function reassignVehicleAction(formData: FormData): Promise<ReassignResult> {
  await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  // Optional co-driver for >400km trips (recommendation-assign). Only set when
  // explicitly passed, so a plain drag-drop never clears an existing co-driver.
  const secondaryDriverIdIn = String(formData.get("secondaryDriverId") ?? "") || null;
  if (!bookingId || !vehicleId) return { ok: false, error: "invalidInput" };

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "bookingNotFound" };
  // A dead booking is not dispatchable. This action used to read no status at
  // all: cancelBookingAction and the deny paths leave `overflowReason` set, and
  // the /admin/batch overflow list is keyed on `overflowReason: { not: null }`,
  // so a CANCELLED or DENIED trip stayed on the "ทริปที่จัดไม่ได้" list with a
  // live assign button — one click committed a car and a driver to a trip
  // nobody wanted, and the occupancy row it wrote then blocked a real one.
  if (!DISPATCHABLE_STATUSES.includes(booking.status)) {
    return { ok: false, error: "cannotAssignInStatus" };
  }
  // External charter (SMUS) — outside buses/vans, not placed on an internal car.
  if (booking.jobType === "SMUS") return { ok: false, error: "externalCharterNoMatch" };
  // Outsourced-rental bus — same as SMUS, never placed on an internal car.
  if (booking.preferredVehicleType === "BUS_OUTSOURCED") {
    return { ok: false, error: "outsourcedVehicleNoMatch" };
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      assignedDriverId: true,
      assignedDriver: { select: { isActive: true, user: { select: { isActive: true } } } },
    },
  });
  // A deactivated driver (or one whose user was deactivated) can't be dispatched,
  // so treat their car as driverless rather than assigning a "removed" driver.
  if (
    !vehicle?.assignedDriverId ||
    !vehicle.assignedDriver?.isActive ||
    !vehicle.assignedDriver.user?.isActive
  ) {
    return { ok: false, error: "noAssignedDriver" };
  }

  // No overlap, ever — on EVERY car, including the duty car. A manual override
  // (drag / assign-reco) may relax the 2h chaining gap and may put a trip on a
  // driver marked off (sick/leave) — both are deliberate P'Top overrides, not
  // blocked here; only AUTO-assign honors those. It must never double-book a car.
  // Skip only when re-dropping on the same car (a booking can't collide with
  // itself; the query already excludes its own id).
  if (vehicleId !== booking.vehicleId) {
    // SQL window-overlap is a coarse PREFILTER (superset of leg-overlap); refine
    // per-leg in JS so a trip that only fits a no-wait trip's freed middle is not
    // flagged as a conflict.
    const candidates = await prisma.booking.findMany({
      where: {
        id: { not: bookingId },
        vehicleId,
        // Match the DB occupancy trigger (APPROVED|ASSIGNED|COMPLETED). Without
        // COMPLETED here the pre-check misses a finished trip that still holds an
        // occupancy row, so the drop is rejected by the EXCLUDE with an UNNAMED
        // vehicleBusy instead of a named conflict.
        status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
        startAt: { lt: booking.endAt },
        endAt: { gt: booking.startAt },
      },
      orderBy: { startAt: "asc" },
      select: {
        destination: true, startAt: true, endAt: true, travelWithinChula: true,
        waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
      },
    });
    const bookingLeg = toLegSrc(booking);
    const conflicts = candidates
      // §5c: two in-Chula errands starting within ten minutes may share the car.
      // Without this the manual drop would still refuse what the database now
      // permits and what จัด now does on its own — the board contradicting the
      // solver is worse than either rule alone.
      .filter((c) => !sharesCarWith(booking, c))
      .filter((c) => legsOverlap(bookingLeg, toLegSrc(c)))
      .slice(0, 3)
      .map((c) => ({ destination: c.destination, startAt: c.startAt, endAt: c.endAt }));
    if (conflicts.length > 0) return { ok: false, error: "vehicleBusy", conflicts };
  }

  const driverId = vehicle.assignedDriverId;
  // A driver can't be in two places at once. The per-vehicle check + DB EXCLUDE
  // above only guard the TARGET CAR, but this car's assigned driver may already
  // be riding as a CO-DRIVER in ANOTHER car's trip (a co-driver rides in the
  // primary's car, so their own car stays free and neither guard catches it —
  // docs/scheduling-algorithm.md §5). Reject an overlapping commitment on any
  // OTHER car. Overlap on a driver is never override-relaxable (unlike the 2h gap).
  {
    const elsewhere = await prisma.booking.findMany({
      where: {
        id: { not: bookingId },
        vehicleId: { not: vehicleId }, // the target car's own trips are checked above
        status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
        OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
        startAt: { lt: booking.endAt },
        endAt: { gt: booking.startAt },
      },
      orderBy: { startAt: "asc" },
      select: {
        destination: true, startAt: true, endAt: true,
        waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
      },
    });
    const bookingLeg = toLegSrc(booking);
    const driverConflicts = elsewhere
      .filter((c) => legsOverlap(bookingLeg, toLegSrc(c)))
      .slice(0, 3)
      .map((c) => ({ destination: c.destination, startAt: c.startAt, endAt: c.endAt }));
    if (driverConflicts.length > 0) return { ok: false, error: "vehicleBusy", conflicts: driverConflicts };
  }
  // Re-validate the recommended co-driver: it was picked as free at render time,
  // but could have been booked since. Drop it (place primary only) if it now has
  // an overlapping trip — never silently double-book the co-driver.
  let secondary = secondaryDriverIdIn && secondaryDriverIdIn !== driverId ? secondaryDriverIdIn : null;
  if (secondary) {
    // The co-driver may have been deactivated between render and assign — never
    // assign a removed driver as secondary.
    const secActive = await prisma.driver.findFirst({
      where: { id: secondary, isActive: true, user: { is: { isActive: true } } },
      select: { id: true },
    });
    if (!secActive) secondary = null;
  }
  if (secondary) {
    // Coarse window-overlap prefilter, then refine per-leg: the co-driver is only
    // busy if a LEG of one of their trips overlaps a leg of this trip.
    const secCandidates = await prisma.booking.findMany({
      where: {
        id: { not: bookingId },
        status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
        OR: [{ primaryDriverId: secondary }, { secondaryDriverId: secondary }],
        startAt: { lt: booking.endAt },
        endAt: { gt: booking.startAt },
      },
      select: { startAt: true, endAt: true, waitAtDestination: true, dropOffDone: true, pickupReturnTime: true },
    });
    const bookingLeg = toLegSrc(booking);
    if (secCandidates.some((c) => legsOverlap(bookingLeg, toLegSrc(c)))) secondary = null;
  }

  // One person cannot hold both seats. Dropping a trip onto the car of the
  // driver who is ALREADY its co-driver made `driverId === booking.secondaryDriverId`:
  // the incoming-secondary guard above only looks at `secondaryDriverIdIn` (empty
  // on a plain drag), and both overlap queries carry `id: { not: bookingId }` so
  // neither can see this booking's own co-driver seat. The row was written with
  // primaryDriverId === secondaryDriverId, which paints a co-driver ghost, leaves
  // `needsCoDriver` false, and credits that driver twice in loadWeightedEarnings —
  // a >400 km trip dispatched with one driver while looking fully staffed.
  //
  // Vacate the seat rather than refusing the drop (P'Top's move is legitimate —
  // they are promoting the co-driver to primary), and re-raise the overflow flag
  // when the trip still legally needs two, so it comes back as unfinished work
  // instead of passing as complete. reassignSecondaryAction refuses the mirror
  // case outright because there the co-driver is what is being chosen.
  const secondaryCollides = booking.secondaryDriverId === driverId;
  const stillNeedsCoDriver =
    booking.needsSecondaryDriver || (booking.estimatedDistance ?? 0) > LONG_TRIP_KM;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          vehicleId,
          primaryDriverId: driverId,
          ...(secondary ? { secondaryDriverId: secondary } : {}),
          ...(secondaryCollides && !secondary ? { secondaryDriverId: null } : {}),
          status: "ASSIGNED",
          driverScheduleStatus: "CONFIRMED",
          decidedAt: new Date(),
          // Placing it by hand IS the resolution — the reason it could not be
          // placed, or was frozen for review, stops being true here. Without
          // this the trip returns to the day's overflow bar the moment the page
          // refreshes, with no way left to dismiss it but unassigning again.
          //
          // Except when the move just emptied the co-driver seat on a trip that
          // legally needs one: clearing the flag there would file a half-staffed
          // long-haul as resolved.
          overflowReason:
            secondaryCollides && !secondary && stillNeedsCoDriver ? "NO_SECONDARY_DRIVER" : null,
        },
      });
      await stampRotationForward(tx, driverId, booking.startAt);
      if (secondary) await stampRotationForward(tx, secondary, booking.startAt);
    });
  } catch (e) {
    // DB backstop: the no-double-book EXCLUDE caught an overlap the per-leg
    // pre-check above missed (a bug or a race). Degrade to the same friendly
    // result instead of a 500.
    if (isExclusionViolation(e)) return { ok: false, error: "vehicleBusy" };
    throw e;
  }

  revalidatePath("/admin/schedule");
  return { ok: true };
}

// Move (or remove) a long-haul trip's CO-DRIVER by dragging the violet ghost.
// Dropping it on another car's row makes THAT car's driver the new co-driver;
// dropping it off any row (empty vehicleId) removes the co-driver. The co-driver
// rides in the PRIMARY's car — this only changes who co-drives, never the
// dispatched vehicle. Same overlap + active-driver guards as a primary reassign.
export async function reassignSecondaryAction(formData: FormData): Promise<ReassignResult> {
  await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  const vehicleId = String(formData.get("vehicleId") ?? ""); // "" = remove co-driver
  if (!bookingId) return { ok: false, error: "invalidInput" };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, primaryDriverId: true, startAt: true, endAt: true,
      waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
      overflowReason: true, status: true,
    },
  });
  if (!booking) return { ok: false, error: "bookingNotFound" };
  // Same gate as the primary path: a cancelled/denied/completed trip takes no
  // more crew. This one could also be reached from a stale board.
  if (!DISPATCHABLE_STATUSES.includes(booking.status)) {
    return { ok: false, error: "cannotAssignInStatus" };
  }

  // Drop off a row → remove the co-driver.
  if (!vehicleId) {
    await prisma.booking.update({ where: { id: bookingId }, data: { secondaryDriverId: null } });
    revalidatePath("/admin/schedule");
    return { ok: true };
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      assignedDriverId: true,
      assignedDriver: { select: { isActive: true, user: { select: { isActive: true } } } },
    },
  });
  if (
    !vehicle?.assignedDriverId ||
    !vehicle.assignedDriver?.isActive ||
    !vehicle.assignedDriver.user?.isActive
  ) {
    return { ok: false, error: "noAssignedDriver" };
  }
  const newSecondary = vehicle.assignedDriverId;
  // A driver can't co-drive their own (or anyone's) trip as both roles.
  if (newSecondary === booking.primaryDriverId) return { ok: false, error: "coDriverSamePrimary" };

  // No overlap — the new co-driver must be free across the trip window. Coarse SQL
  // window is a superset of leg-overlap; refine per-leg via trip-legs.ts (the single
  // source of truth) so a co-driver that fits a no-wait trip's freed middle is not
  // falsely blocked. Matches reassignVehicleAction's per-leg checks.
  const secCandidates = await prisma.booking.findMany({
    where: {
      id: { not: bookingId },
      status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
      OR: [{ primaryDriverId: newSecondary }, { secondaryDriverId: newSecondary }],
      startAt: { lt: booking.endAt },
      endAt: { gt: booking.startAt },
    },
    orderBy: { startAt: "asc" },
    select: {
      destination: true, startAt: true, endAt: true,
      waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
    },
  });
  const bookingLeg = toLegSrc(booking);
  const conflicts = secCandidates
    .filter((c) => legsOverlap(bookingLeg, toLegSrc(c)))
    .slice(0, 3)
    .map((c) => ({ destination: c.destination, startAt: c.startAt, endAt: c.endAt }));
  if (conflicts.length > 0) return { ok: false, error: "vehicleBusy", conflicts };

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      // Filling the co-driver seat resolves NO_SECONDARY_DRIVER — the only
      // reason this action can be the answer to. Leave any other reason alone.
      data: {
        secondaryDriverId: newSecondary,
        ...(booking.overflowReason === "NO_SECONDARY_DRIVER" ? { overflowReason: null } : {}),
      },
    });
    await stampRotationForward(tx, newSecondary, booking.startAt);
  });
  revalidatePath("/admin/schedule");
  return { ok: true };
}

// Drag an assigned block back up to the queue: clear the trip's car + driver(s)
// so it returns to the unassigned pool. Releases the drivers' claims and rolls
// their rotation stamps back (so a removed TJW doesn't keep a driver "stamped"
// as having done it — same recompute the cancellation path uses).
export async function unassignBookingAction(formData: FormData): Promise<ReassignResult> {
  await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return { ok: false, error: "invalidInput" };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { primaryDriverId: true, secondaryDriverId: true, jobType: true, status: true },
  });
  if (!booking) return { ok: false, error: "bookingNotFound" };
  // A COMPLETED trip's crew is history, not an assignment to undo — stripping it
  // would erase who actually drove, and the same board control reaches it.
  // CANCELLED / DENIED never reach here with a driver, but the gate is the same
  // question, so it is asked the same way.
  if (!DISPATCHABLE_STATUSES.includes(booking.status)) {
    return { ok: false, error: "cannotAssignInStatus" };
  }
  // Nothing assigned → already in the queue.
  if (!booking.primaryDriverId) return { ok: true };

  const freedDrivers = [booking.primaryDriverId, booking.secondaryDriverId].filter(
    (id): id is string => !!id,
  );

  await prisma.$transaction(async (tx) => {
    await tx.bookingClaim.deleteMany({ where: { bookingId } });
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        vehicleId: null,
        primaryDriverId: null,
        secondaryDriverId: null,
        status: "APPROVED",
        driverScheduleStatus: "UNCLAIMED",
        decidedAt: null,
        overflowReason: null,
        escalatedToKhunTop: false,
      },
    });
    await logTransition({
      bookingId,
      actorUserId: (await requireRole("ADMIN")).user.id,
      fromStatus: booking.status,
      toStatus: "APPROVED",
      action: "UNASSIGNED",
      metadata: { freedDrivers },
      tx,
    });
  });

  // Recompute each freed driver's category stamp from their remaining trips
  // (this booking is now unassigned, so it's excluded).
  for (const driverId of freedDrivers) {
    await recomputeRotationStamp(driverId, booking.jobType);
  }

  revalidatePath("/admin/schedule");
  return { ok: true };
}

/** "HH:mm" onto the calendar day of `ref` — the date is kept, the clock replaced. */
function withTimeOfDay(ref: Date, hhmm: string): Date | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(ref);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}

/**
 * Move a trip's hours — any job type, TIME ONLY.
 *
 * This was WERN-only: เวร is campus errands the duty driver runs, so its hour is
 * negotiable in a way a meeting pickup is not. In practice P'Top has to slide
 * every kind of job (a car comes back late, a meeting moves an hour), and the
 * refusal just meant editing the row in the database. So the gate is gone and
 * the guards below carry the weight instead.
 *
 * The DATE cannot move here: each timestamp keeps its own calendar day and only
 * its clock is replaced, so an overnight TJW still spans the same nights and a
 * one-day board can never fling a job into a day you can't see. Moving a trip to
 * another date stays a booking edit, not a dispatch action.
 *
 * The car keeps its existing occupancy rules: moving into another trip's window
 * is refused by the same per-leg overlap check a drag uses, the driver's own
 * commitments on other cars are checked too (the per-vehicle DB exclusion can't
 * see those), and the exclusion constraint is the backstop if two admins move at
 * once. A trip that has already departed is not re-timed at all.
 */
export async function setBookingTimeAction(formData: FormData): Promise<ReassignResult> {
  const session = await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  const startHHmm = String(formData.get("startHHmm") ?? "");
  const endHHmm = String(formData.get("endHHmm") ?? "");
  if (!bookingId || !startHHmm || !endHHmm) return { ok: false, error: "invalidInput" };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, jobType: true, vehicleId: true, status: true, startAt: true, endAt: true,
      primaryDriverId: true, secondaryDriverId: true,
      waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
      trip: { select: { startedAt: true } },
    },
  });
  if (!booking) return { ok: false, error: "bookingNotFound" };
  // Departed (or finished) is history — §9b of the scheduling doc keeps such a
  // trip out of re-dispatch, and re-timing it would rewrite what happened.
  if (booking.trip?.startedAt) return { ok: false, error: "tripAlreadyStarted" };
  if (!COMMITTED_STATUSES.includes(booking.status)) {
    return { ok: false, error: "cannotEditTimeInStatus" };
  }

  // Dates preserved per-timestamp: the end keeps ITS day, so an overnight trip
  // stays overnight instead of collapsing onto the start day.
  const startAt = withTimeOfDay(booking.startAt, startHHmm);
  const endAt = withTimeOfDay(booking.endAt, endHHmm);
  if (!startAt || !endAt) return { ok: false, error: "invalidInput" };
  if (endAt <= startAt) return { ok: false, error: "endBeforeStart" };

  // A no-wait trip is two legs, and its split points (dropOffDone, and the
  // pickupReturnTime that starts leg 2) are NOT edited here. Shifting the outer
  // window past them would invert a leg — the overlap math would then read as
  // "free" a stretch the car is actually out on. Refuse instead of silently
  // dragging the split times along.
  if (!booking.waitAtDestination && booking.dropOffDone && booking.pickupReturnTime) {
    const leg2Start = withTimeOfDay(startAt, booking.pickupReturnTime);
    const dropOff = booking.dropOffDone;
    if (!leg2Start || startAt >= dropOff || leg2Start <= dropOff || leg2Start >= endAt) {
      return { ok: false, error: "timeBreaksLegs" };
    }
  }

  // The window being moved TO, in leg terms.
  const movedLeg = toLegSrc({
    startAt, endAt,
    waitAtDestination: booking.waitAtDestination,
    dropOffDone: booking.dropOffDone,
    pickupReturnTime: booking.pickupReturnTime,
  });

  // Same car, new window: refuse if it would collide with anything else on it.
  if (booking.vehicleId) {
    const clashes = await prisma.booking.findMany({
      where: {
        id: { not: bookingId },
        vehicleId: booking.vehicleId,
        status: { in: COMMITTED_STATUSES },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: {
        destination: true, startAt: true, endAt: true,
        waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
      },
    });
    // legsOverlap, not the raw window: a no-wait trip frees its middle, so a
    // whole-trip comparison refused เวร hours that legally fit inside that gap.
    // The SQL bounds above stay as a cheap pre-filter.
    const carConflicts = clashes
      .filter((c) => legsOverlap(movedLeg, toLegSrc(c)))
      .map((c) => ({ destination: c.destination, startAt: c.startAt, endAt: c.endAt }));
    if (carConflicts.length > 0) {
      return { ok: false, error: "vehicleBusy", conflicts: carConflicts };
    }
  }

  // The DRIVER's other commitments, on any OTHER car.
  //
  // The occupancy EXCLUDE is per-vehicle, so it cannot see this: moving เวร hours
  // on car A into a window where that same driver is already riding on car B
  // double-books the person while every car stays legal. The drag path has this
  // guard; the เวร hour editor never did. Overlap on a driver is never
  // override-relaxable, unlike the 2 h gap.
  const driverIds = [booking.primaryDriverId, booking.secondaryDriverId].filter(
    (d): d is string => !!d,
  );
  if (driverIds.length > 0) {
    const elsewhere = await prisma.booking.findMany({
      where: {
        id: { not: bookingId },
        ...(booking.vehicleId ? { vehicleId: { not: booking.vehicleId } } : {}),
        status: { in: COMMITTED_STATUSES },
        OR: [
          { primaryDriverId: { in: driverIds } },
          { secondaryDriverId: { in: driverIds } },
        ],
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      orderBy: { startAt: "asc" },
      select: {
        destination: true, startAt: true, endAt: true,
        waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
      },
    });
    const driverConflicts = elsewhere
      .filter((c) => legsOverlap(movedLeg, toLegSrc(c)))
      .slice(0, 3)
      .map((c) => ({ destination: c.destination, startAt: c.startAt, endAt: c.endAt }));
    if (driverConflicts.length > 0) {
      return { ok: false, error: "vehicleBusy", conflicts: driverConflicts };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: bookingId }, data: { startAt, endAt } });
      await logTransition({
        bookingId,
        actorUserId: session.user.id,
        fromStatus: booking.status,
        toStatus: booking.status,
        // One action name for every job type — WERN_TIME_CHANGED rows written
        // before this became general are still in the log and still readable.
        action: "TIME_CHANGED",
        metadata: {
          jobType: booking.jobType,
          from: { startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString() },
          to: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
        },
        tx,
      });
    });
  } catch (err) {
    // The per-vehicle GiST constraint is the backstop against a concurrent move.
    if (isExclusionViolation(err)) return { ok: false, error: "vehicleBusy" };
    throw err;
  }

  // เวร is the dispatcher's own errand and has no waiting requester; every other
  // job type IS somebody's booking, and a silently moved pickup is somebody
  // standing outside at the old time. Mail is best-effort: the move is already
  // committed, so a mail failure must not report the move as failed.
  if (booking.jobType !== "WERN") {
    const detailed = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: bookingDetailInclude,
    });
    if (detailed?.requester.email) {
      try {
        await sendEmail({
          to: detailed.requester.email,
          ...requesterTimeChangedEmail(detailed, { startAt: booking.startAt, endAt: booking.endAt }),
        });
      } catch {
        // Logged by the mail client; the schedule change stands either way.
      }
    }
  }

  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/driver/schedule");
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}
