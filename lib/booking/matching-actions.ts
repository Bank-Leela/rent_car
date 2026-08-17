"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logEvent, logTransition } from "@/lib/booking/audit";
import { matchBookingSchema } from "@/lib/booking/schema";
import { driverVehicleMap } from "@/lib/booking/fleet";
import {
  buildDriverMatrix,
  type DriverAvailabilityInput,
  type DriverBusyTrip,
  type DriverInput,
  type RankInput,
  type TripWindow,
} from "@/lib/booking/driver-capacity";
import { match } from "@/lib/booking/matching";
import { isExclusionViolation } from "@/lib/booking/db-errors";
import { resolveWernDriver, pickAutoDutyDriver } from "@/lib/booking/duty-assignment";
import { WORK_DAY_START_HOUR, WORK_DAY_END_HOUR } from "@/lib/booking/classification";
import { loadWeightedEarnings } from "@/lib/booking/earnings";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";
import type { ActionResult } from "@/lib/booking/actions";

export async function matchBookingAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = matchBookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  // External charter (SMUS) — no internal vehicle/driver to match.
  if (booking.jobType === "SMUS") {
    return { ok: false, error: te("externalCharterNoMatch") };
  }
  // Outsourced-rental bus — same as SMUS, no internal vehicle/driver to match.
  if (booking.preferredVehicleType === "BUS_OUTSOURCED") {
    return { ok: false, error: te("outsourcedVehicleNoMatch") };
  }
  if (booking.status !== "APPROVED") {
    return { ok: false, error: te("cannotMatchInStatus", { status: ts(booking.status) }) };
  }
  if (booking.primaryDriverId) {
    return { ok: false, error: te("alreadyHasPrimary") };
  }

  const tripDay = startOfDay(booking.startAt);
  const dayEnd = new Date(tripDay);
  dayEnd.setDate(dayEnd.getDate() + 1);
  // For a multi-day trip (TJW), extend the conflict window to the FULL span, not
  // just day 1 — else a driver already booked on day 2/3 isn't seen and gets
  // double-booked. max(dayEnd, endAt) keeps day-1 chaining/cap for single-day trips.
  const spanEnd = booking.endAt > dayEnd ? booking.endAt : dayEnd;

  // car=driver: vehicle = chosen driver's car. Load the pairing, no slot search.
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    select: { id: true, assignedDriverId: true },
  });
  const driverCar = driverVehicleMap(vehicles);
  const dayBookings = await prisma.booking.findMany({
    where: {
      // Overlap, not start-in-day: a multi-day trip that began earlier still
      // occupies the driver today. With a start-in-day window the matcher misses
      // a driver who's still away on a multi-day TJW and assigns them anyway.
      // spanEnd (not dayEnd) so the NEW trip's own day-2/3 overlaps are seen too.
      startAt: { lt: spanEnd },
      endAt: { gt: tripDay },
      status: { in: COMMITTED_STATUSES },
      id: { not: bookingId },
    },
    select: {
      vehicleId: true,
      timeBucket: true,
      primaryDriverId: true,
      secondaryDriverId: true,
      jobType: true,
      startAt: true,
      endAt: true,
      waitAtDestination: true,
      dropOffDone: true,
      pickupReturnTime: true,
    },
  });
  // --- Algorithm 2 inputs ---
  const drivers = await prisma.driver.findMany({
    // Gate on the owning User's isActive: deactivating a user removes the driver
    // from scheduling (Driver.isActive is never toggled on its own). Also skip
    // anyone marked off for the day (sick / leave).
    where: {
      isActive: true,
      user: { is: { isActive: true } },
      unavailabilities: { none: { date: tripDay } },
    },
    select: { id: true, createdAt: true, lastAssignedAt: true, lastDutyAt: true },
  });
  if (drivers.length === 0) return { ok: false, error: te("noActiveDrivers") };

  // Today's on-call driver is pre-seeded as busy on ON_CALL (campus rounds).
  // Ignore a shift whose driver is no longer in the active pool (a ghost) so a
  // WERN booking doesn't route to a deactivated driver.
  const onCall = await prisma.onCallShift.findUnique({ where: { date: tripDay } });
  const onCallDriverId =
    onCall?.driverId && drivers.some((d) => d.id === onCall.driverId) ? onCall.driverId : null;

  // Drivers away on a multi-day TJW spanning today (primary OR co-driver) can't
  // run campus duty. A WERN booking must skip them — even the on-call driver —
  // and fall back to a present driver (mirrors the solver's awayOnTjw rule).
  const awayTjwDriverIds = new Set<string>();
  for (const b of dayBookings) {
    if (b.jobType !== "TJW") continue;
    if (b.primaryDriverId) awayTjwDriverIds.add(b.primaryDriverId);
    if (b.secondaryDriverId) awayTjwDriverIds.add(b.secondaryDriverId);
  }
  // WERN routes to the on-call driver unless they're away — then the duty rotation
  // falls back. For non-WERN, this is just the (reserved) real on-call driver.
  const wernDriverId =
    booking.jobType === "WERN"
      ? resolveWernDriver({
          onCallDriverId,
          awayDriverIds: awayTjwDriverIds,
          hasCar: (id) => driverCar.has(id),
          candidates: drivers.map((d) => ({ driverId: d.id, lastDutyAt: d.lastDutyAt })),
        })
      : onCallDriverId;

  const busyToday: DriverBusyTrip[] = [];
  for (const b of dayBookings) {
    if (b.primaryDriverId) busyToday.push({ driverId: b.primaryDriverId, jobType: b.jobType });
    if (b.secondaryDriverId) busyToday.push({ driverId: b.secondaryDriverId, jobType: b.jobType });
  }
  if (onCallDriverId) {
    busyToday.push({ driverId: onCallDriverId, jobType: "WERN" });
  }
  const driverInputs: DriverInput[] = drivers.map((d) => ({
    driverId: d.id,
    joinedAt: d.createdAt,
    lastAssignedAt: d.lastAssignedAt,
  }));
  const driverMatrix = buildDriverMatrix(driverInputs, busyToday);

  // Temporal availability: per-driver list of same-day trips. The on-call
  // driver gets a pseudo-trip spanning the morning + afternoon buckets so
  // canTakeTrip() will block them from regular jobs that overlap.
  const tripsByDriver = new Map<string, TripWindow[]>();
  for (const d of drivers) tripsByDriver.set(d.id, []);
  for (const b of dayBookings) {
    if (b.primaryDriverId && tripsByDriver.has(b.primaryDriverId)) {
      tripsByDriver.get(b.primaryDriverId)!.push({ startAt: b.startAt, endAt: b.endAt, jobType: b.jobType, waitAtDestination: b.waitAtDestination, dropOffDone: b.dropOffDone, pickupReturnTime: b.pickupReturnTime });
    }
    if (b.secondaryDriverId && tripsByDriver.has(b.secondaryDriverId)) {
      tripsByDriver.get(b.secondaryDriverId)!.push({ startAt: b.startAt, endAt: b.endAt, jobType: b.jobType, waitAtDestination: b.waitAtDestination, dropOffDone: b.dropOffDone, pickupReturnTime: b.pickupReturnTime });
    }
  }
  // Snapshot the WERN driver's REAL same-day trips BEFORE the 08:00–16:00 duty
  // pseudo-trip is pushed below — match()'s WERN branch uses these to verify the
  // duty car is free before assigning it (the pseudo-trip would overlap every
  // daytime WERN and defeat the check).
  const wernExistingTrips = wernDriverId ? [...(tripsByDriver.get(wernDriverId) ?? [])] : [];
  if (onCallDriverId && tripsByDriver.has(onCallDriverId)) {
    const dutyStart = new Date(tripDay);
    dutyStart.setHours(WORK_DAY_START_HOUR, 0, 0, 0);
    const dutyEnd = new Date(tripDay);
    dutyEnd.setHours(WORK_DAY_END_HOUR, 0, 0, 0);
    tripsByDriver.get(onCallDriverId)!.push({ startAt: dutyStart, endAt: dutyEnd, jobType: "WERN" });
  }
  const driverAvailability: DriverAvailabilityInput[] = drivers.map((d) => ({
    driverId: d.id,
    existing: tripsByDriver.get(d.id) ?? [],
  }));

  const driverIds = drivers.map((d) => d.id);
  const [earnings, monthCounts] = await Promise.all([
    loadWeightedEarnings(driverIds),
    loadTripsThisMonth(driverIds),
  ]);
  const driverRankInputs: RankInput[] = drivers.map((d) => ({
    driverId: d.id,
    earningsScore: earnings.get(d.id) ?? 0,
    tripsThisMonth: monthCounts.get(d.id) ?? 0,
    lastAssignedAt: d.lastAssignedAt,
  }));

  // --- Matching. ---
  const decision = match({
    jobType: booking.jobType,
    timeBucket: booking.timeBucket,
    newTrip: {
      startAt: booking.startAt,
      endAt: booking.endAt,
      jobType: booking.jobType,
      waitAtDestination: booking.waitAtDestination,
      dropOffDone: booking.dropOffDone,
      pickupReturnTime: booking.pickupReturnTime,
    },
    estimatedDistance: booking.estimatedDistance,
    needsSecondaryDriver: booking.needsSecondaryDriver,
    driverCar,
    driverMatrix,
    driverAvailability,
    driverRankInputs,
    onCallDriverId: wernDriverId,
    onCallExistingTrips: wernExistingTrips,
  });
  if (!decision.ok) {
    if (decision.error === "NO_SLOT") return { ok: false, error: te("noSlotAvailable") };
    return { ok: false, error: te("noEligibleDriver") };
  }
  const { vehicleId, primaryDriverId, secondaryDriverId } = decision.result;

  // The matcher's conflict model is DRIVER-based: it builds tripsByDriver from
  // primaryDriverId/secondaryDriverId, so a car allocated with no driver yet
  // (assignBookingAction sets vehicleId alone — the intended CR-02 state) is
  // invisible to it, and the derived `vehicleId = driverCar.get(primaryDriverId)`
  // can land on a car the occupancy EXCLUDE already holds. Uncaught, its 23P01
  // threw straight through the server action and the admin detail page was
  // replaced by the error boundary. lib/booking/actions.ts:96 documents this
  // exact bug being fixed on the sibling path; this was the one that was missed.
  try {
    await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        vehicleId,
        primaryDriverId,
        secondaryDriverId,
        driverScheduleStatus: "CLAIMED",
        decidedAt: new Date(),
        // Matched by hand — whatever reason it carried for not being placed is
        // no longer true, and a stale one keeps it in the overflow bar for good.
        overflowReason: null,
      },
    });
    await tx.bookingClaim.create({
      data: { bookingId, driverId: primaryDriverId, role: "PRIMARY", status: "ACTIVE" },
    });
    if (secondaryDriverId) {
      await tx.bookingClaim.create({
        data: { bookingId, driverId: secondaryDriverId, role: "SECONDARY", status: "ACTIVE" },
      });
    }
    const stamp = booking.startAt;
    await tx.driver.update({ where: { id: primaryDriverId }, data: { lastAssignedAt: stamp } });
    if (secondaryDriverId) {
      await tx.driver.update({ where: { id: secondaryDriverId }, data: { lastAssignedAt: stamp } });
    }
    await logTransition({
      bookingId,
      actorUserId: adminId,
      fromStatus: booking.status,
      toStatus: booking.status,
      action: "MATCHED",
      metadata: { vehicleId, primaryDriverId, secondaryDriverId },
      tx,
    });
    });
  } catch (err) {
    if (!isExclusionViolation(err)) throw err;
    return { ok: false, field: "vehicleId", error: te("vehicleConflict") };
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  return { ok: true };
}

// CR-06: ops escalates a booking to Khun Top when the matcher can't find a
// fit. Flips the flag, writes an audit row. UI prompts after a match failure.
export async function escalateToKhunTopAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;
  const te = await getTranslations("errors");

  const parsed = matchBookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { escalatedToKhunTop: true },
    });
    await logTransition({
      bookingId,
      actorUserId: adminId,
      fromStatus: booking.status,
      toStatus: booking.status,
      action: "ESCALATED_TO_KHUN_TOP",
      metadata: { reason: "matcher_no_fit" },
      tx,
    });
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  return { ok: true };
}

async function loadTripsThisMonth(driverIds: string[]): Promise<Map<string, number>> {
  if (driverIds.length === 0) return new Map();
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const counts = new Map<string, number>(driverIds.map((id) => [id, 0]));
  const rows = await prisma.booking.findMany({
    where: {
      startAt: { gte: firstOfMonth },
      // Count claimed (APPROVED) trips too, consistent with the fairness ledger.
      status: { in: COMMITTED_STATUSES },
      OR: [
        { primaryDriverId: { in: driverIds } },
        { secondaryDriverId: { in: driverIds } },
      ],
    },
    select: { primaryDriverId: true, secondaryDriverId: true },
  });
  for (const b of rows) {
    if (b.primaryDriverId && counts.has(b.primaryDriverId)) {
      counts.set(b.primaryDriverId, counts.get(b.primaryDriverId)! + 1);
    }
    if (b.secondaryDriverId && counts.has(b.secondaryDriverId)) {
      counts.set(b.secondaryDriverId, counts.get(b.secondaryDriverId)! + 1);
    }
  }
  return counts;
}

export async function setOnCallShiftAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const date = String(formData.get("date") ?? "");
  const driverId = String(formData.get("driverId") ?? "").trim() || undefined;
  if (!date) return { ok: false, error: te("invalidInput") };
  const day = new Date(`${date}T00:00:00`);
  if (Number.isNaN(day.getTime())) return { ok: false, error: te("invalidInput") };

  let chosenDriverId = driverId;
  if (chosenDriverId) {
    // An explicitly chosen duty driver must be active (a deactivated driver
    // would become a ghost the solver/matcher can't route WERN to) and not
    // marked off (sick / leave) for that day.
    const ok = await prisma.driver.findFirst({
      where: {
        id: chosenDriverId,
        isActive: true,
        user: { is: { isActive: true } },
        unavailabilities: { none: { date: day } },
      },
      select: { id: true },
    });
    if (!ok) return { ok: false, error: te("invalidInput"), field: "driverId" };
  } else {
    const drivers = await prisma.driver.findMany({
      where: {
        isActive: true,
        user: { is: { isActive: true } },
        unavailabilities: { none: { date: day } },
      },
      select: {
        id: true,
        onCallShifts: { orderBy: { date: "desc" }, take: 1, select: { date: true } },
      },
    });
    if (drivers.length === 0) return { ok: false, error: te("noActiveDrivers") };

    // Don't rotate duty onto a driver away on a multi-day TJW spanning the day —
    // they can't run campus rounds. Skip them; pickAutoDutyDriver still names
    // someone (full pool) if every candidate happens to be away.
    const dayEnd = new Date(day);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const tjwSpanning = await prisma.booking.findMany({
      where: { jobType: "TJW", status: { in: COMMITTED_STATUSES }, startAt: { lt: dayEnd }, endAt: { gt: day } },
      select: { primaryDriverId: true, secondaryDriverId: true },
    });
    const awayIds = new Set<string>();
    for (const t of tjwSpanning) {
      if (t.primaryDriverId) awayIds.add(t.primaryDriverId);
      if (t.secondaryDriverId) awayIds.add(t.secondaryDriverId);
    }
    chosenDriverId =
      pickAutoDutyDriver(
        drivers.map((d) => ({ driverId: d.id, lastOnCallAt: d.onCallShifts[0]?.date ?? null })),
        awayIds,
      ) ?? undefined;
    if (!chosenDriverId) return { ok: false, error: te("noActiveDrivers") };
  }

  // Who held it before, so the audit row says what actually changed rather than
  // only what it became.
  const before = await prisma.onCallShift.findUnique({
    where: { date: day },
    select: { driverId: true },
  });

  await prisma.onCallShift.upsert({
    where: { date: day },
    create: { date: day, driverId: chosenDriverId },
    update: { driverId: chosenDriverId },
  });

  if (before?.driverId !== chosenDriverId) {
    await logEvent({
      actorUserId: session.user.id,
      entityType: "ON_CALL",
      entityId: date,
      action: "ON_CALL_SHIFT_SET",
      metadata: {
        date,
        fromDriverId: before?.driverId ?? null,
        toDriverId: chosenDriverId,
        // An explicitly named driver is P'Top's choice; an empty field means the
        // rotation picked. Worth keeping apart when reading the history back.
        picked: driverId ? "manual" : "rotation",
      },
    });
  }

  revalidatePath("/admin");
  return { ok: true };
}

