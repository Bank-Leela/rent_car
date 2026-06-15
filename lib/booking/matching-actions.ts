"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
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
import { loadWeightedEarnings } from "@/lib/booking/earnings";
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
  if (booking.status !== "APPROVED") {
    return { ok: false, error: te("cannotMatchInStatus", { status: ts(booking.status) }) };
  }
  if (booking.primaryDriverId) {
    return { ok: false, error: te("alreadyHasPrimary") };
  }

  const tripDay = startOfDay(booking.startAt);
  const dayEnd = new Date(tripDay);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // car=driver: vehicle = chosen driver's car. Load the pairing, no slot search.
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    select: { id: true, assignedDriverId: true },
  });
  const driverCar = driverVehicleMap(vehicles);
  const dayBookings = await prisma.booking.findMany({
    where: {
      startAt: { gte: tripDay, lt: dayEnd },
      status: { in: ["APPROVED", "ASSIGNED"] },
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
    },
  });
  // --- Algorithm 2 inputs ---
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    select: { id: true, createdAt: true, lastAssignedAt: true },
  });
  if (drivers.length === 0) return { ok: false, error: te("noActiveDrivers") };

  // Today's on-call driver is pre-seeded as busy on ON_CALL (campus rounds).
  const onCall = await prisma.onCallShift.findUnique({ where: { date: tripDay } });
  const onCallDriverId = onCall?.driverId ?? null;

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
      tripsByDriver.get(b.primaryDriverId)!.push({ startAt: b.startAt, endAt: b.endAt, jobType: b.jobType });
    }
    if (b.secondaryDriverId && tripsByDriver.has(b.secondaryDriverId)) {
      tripsByDriver.get(b.secondaryDriverId)!.push({ startAt: b.startAt, endAt: b.endAt, jobType: b.jobType });
    }
  }
  if (onCallDriverId && tripsByDriver.has(onCallDriverId)) {
    const dutyStart = new Date(tripDay);
    dutyStart.setHours(8, 0, 0, 0);
    const dutyEnd = new Date(tripDay);
    dutyEnd.setHours(16, 0, 0, 0);
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
    newTrip: { startAt: booking.startAt, endAt: booking.endAt, jobType: booking.jobType },
    estimatedDistance: booking.estimatedDistance,
    driverCar,
    driverMatrix,
    driverAvailability,
    driverRankInputs,
    onCallDriverId,
  });
  if (!decision.ok) {
    if (decision.error === "NO_SLOT") return { ok: false, error: te("noSlotAvailable") };
    return { ok: false, error: te("noEligibleDriver") };
  }
  const { vehicleId, primaryDriverId, secondaryDriverId } = decision.result;

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        vehicleId,
        primaryDriverId,
        secondaryDriverId,
        driverScheduleStatus: "CLAIMED",
        decidedAt: new Date(),
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
    await tx.auditLog.create({
      data: {
        bookingId,
        actorUserId: adminId,
        fromStatus: booking.status,
        toStatus: booking.status,
        action: "MATCHED",
        metadata: { vehicleId, primaryDriverId, secondaryDriverId },
      },
    });
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/driver/board");
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
    await tx.auditLog.create({
      data: {
        bookingId,
        actorUserId: adminId,
        fromStatus: booking.status,
        toStatus: booking.status,
        action: "ESCALATED_TO_KHUN_TOP",
        metadata: { reason: "matcher_no_fit" },
      },
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
      status: { in: ["ASSIGNED", "COMPLETED"] },
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
  await requireRole("ADMIN");
  const te = await getTranslations("errors");

  const date = String(formData.get("date") ?? "");
  const driverId = String(formData.get("driverId") ?? "").trim() || undefined;
  if (!date) return { ok: false, error: te("invalidInput") };
  const day = new Date(`${date}T00:00:00`);
  if (Number.isNaN(day.getTime())) return { ok: false, error: te("invalidInput") };

  let chosenDriverId = driverId;
  if (!chosenDriverId) {
    const drivers = await prisma.driver.findMany({
      where: { isActive: true },
      select: {
        id: true,
        onCallShifts: { orderBy: { date: "desc" }, take: 1, select: { date: true } },
      },
    });
    if (drivers.length === 0) return { ok: false, error: te("noActiveDrivers") };
    const sorted = [...drivers].sort((a, b) => {
      const at = a.onCallShifts[0]?.date.getTime() ?? -Infinity;
      const bt = b.onCallShifts[0]?.date.getTime() ?? -Infinity;
      return at - bt;
    });
    chosenDriverId = sorted[0]!.id;
  }

  await prisma.onCallShift.upsert({
    where: { date: day },
    create: { date: day, driverId: chosenDriverId },
    update: { driverId: chosenDriverId },
  });

  revalidatePath("/admin");
  revalidatePath("/driver/board");
  return { ok: true };
}
