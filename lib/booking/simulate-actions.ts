"use server";

import { startOfDay } from "date-fns";
import { getLocale } from "next-intl/server";
import type { JobType, OverflowReason } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";
import { solveDay, type SolverBookingInput, type TjwCommitment } from "@/lib/booking/batch-solver";
import { driverVehicleMap } from "@/lib/booking/fleet";
import { loadWeightedEarnings } from "@/lib/booking/earnings";
import type { DriverRotationState, ScheduledTrip } from "@/lib/booking/rotations";

const JOB_TYPES: JobType[] = ["NORMAL", "OT", "TJW", "WERN", "SMUS"];

export type SimResult =
  | {
      ok: true;
      kind: "fit" | "reclaim";
      registrationNumber: string | null;
      driverName: string | null;
      secondaryDriverName: string | null;
      dutyDriverName: string | null;
      jobType: JobType;
    }
  | { ok: true; kind: "none"; reason: OverflowReason | "NO_SLOT"; dutyDriverName: string | null; jobType: JobType }
  | { ok: false; error: string };

// What-if placement sim: feed one synthetic job (type + time on a chosen day)
// through the SAME solver the daily batch uses (solveDay), against that day's live
// drivers / rotation stamps / duty / committed bookings / TJW away-locks. Read-only
// — nothing is written. Surfaces the exact slot auto-assign would pick (car·driver,
// +co-driver), or the overflow reason if it can't place it. Mirrors batch-actions.
export async function simulatePlacementAction(formData: FormData): Promise<SimResult> {
  await requireRole("ADMIN");
  const dateStr = String(formData.get("date") ?? "");
  const startStr = String(formData.get("start") ?? "");
  const endStr = String(formData.get("end") ?? "");
  const jobTypeStr = String(formData.get("jobType") ?? "");
  const kmRaw = String(formData.get("km") ?? "").trim();
  // No-wait split: "" = not waiting (mirrors the booking form's encoding).
  const waitAtDestination = String(formData.get("wait") ?? "true") !== "";
  const dropOffStr = String(formData.get("dropOff") ?? "");
  const pickupReturnStr = String(formData.get("pickupReturn") ?? "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false, error: "invalidDate" };
  if (!/^\d{2}:\d{2}$/.test(startStr) || !/^\d{2}:\d{2}$/.test(endStr)) return { ok: false, error: "invalidTime" };
  if (!JOB_TYPES.includes(jobTypeStr as JobType)) return { ok: false, error: "invalidJobType" };
  const jobType = jobTypeStr as JobType;

  // Local-time wall-clock on the chosen day (matches the app's local-midnight day).
  const startAt = new Date(`${dateStr}T${startStr}:00`);
  const endAt = new Date(`${dateStr}T${endStr}:00`);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return { ok: false, error: "invalidTime" };
  if (endAt <= startAt) return { ok: false, error: "endBeforeStart" };

  // No-wait split: leg1 = [startAt, dropOffDone], leg2 = [pickupReturnTime, endAt].
  let dropOffDone: Date | null = null;
  if (!waitAtDestination) {
    if (!/^\d{2}:\d{2}$/.test(dropOffStr) || !/^\d{2}:\d{2}$/.test(pickupReturnStr)) {
      return { ok: false, error: "invalidSplit" };
    }
    dropOffDone = new Date(`${dateStr}T${dropOffStr}:00`);
    const ret = new Date(`${dateStr}T${pickupReturnStr}:00`);
    if (!(startAt < dropOffDone && dropOffDone < ret && ret < endAt)) {
      return { ok: false, error: "invalidSplit" };
    }
  }

  const km = kmRaw === "" ? null : Number(kmRaw);
  if (km != null && (!Number.isFinite(km) || km < 0)) return { ok: false, error: "invalidKm" };

  const locale = await getLocale();
  const isThai = locale.toLowerCase().startsWith("th");
  const dayStart = startOfDay(startAt);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // --- Driver pool + rotation snapshots (mirror batch-actions.runBatchAction). ---
  const drivers = await prisma.driver.findMany({
    where: { isActive: true, user: { is: { isActive: true } }, unavailabilities: { none: { date: dayStart } } },
    select: {
      id: true,
      lastTjwAt: true,
      lastOtAt: true,
      lastDutyAt: true,
      lastAssignedAt: true,
      user: { select: { name: true, thaiName: true } },
    },
  });
  if (drivers.length === 0) return { ok: false, error: "noDrivers" };
  const nameOf = (u: { name: string | null; thaiName: string | null }) =>
    (isThai ? u.thaiName ?? u.name : u.name ?? u.thaiName) ?? null;
  const nameById = new Map(drivers.map((d) => [d.id, nameOf(d.user)]));

  const earnings = await loadWeightedEarnings(drivers.map((d) => d.id));
  const driverStates: DriverRotationState[] = drivers.map((d) => ({
    driverId: d.id,
    lastTjwAt: d.lastTjwAt,
    lastOtAt: d.lastOtAt,
    lastDutyAt: d.lastDutyAt,
    lastAssignedAt: d.lastAssignedAt,
    earningsScore: earnings.get(d.id) ?? 0,
  }));

  // car=driver: only paired (car-assigned) drivers are dispatchable.
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    select: { id: true, registrationNumber: true, assignedDriverId: true },
  });
  const driverCar = driverVehicleMap(vehicles);
  const regByVehicle = new Map(vehicles.map((v) => [v.id, v.registrationNumber]));
  const pairedDriverStates = driverStates.filter((d) => driverCar.has(d.driverId));
  if (pairedDriverStates.length === 0) return { ok: false, error: "noDrivers" };

  // Duty driver, validated against the active+paired pool (a deactivated/unpaired
  // duty driver is a ghost — null it so WERN falls back to the duty rotation).
  const onCall = await prisma.onCallShift.findUnique({ where: { date: dayStart }, select: { driverId: true } });
  const dutyDriverId =
    onCall?.driverId && pairedDriverStates.some((d) => d.driverId === onCall.driverId) ? onCall.driverId : null;
  const dutyDriverName = dutyDriverId ? nameById.get(dutyDriverId) ?? null : null;

  // --- Active TJW commitments (multi-day TJW spanning today → away-lock). ---
  const tjwSpanning = await prisma.booking.findMany({
    where: { jobType: "TJW", status: { in: COMMITTED_STATUSES }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
    select: { primaryDriverId: true, secondaryDriverId: true, startAt: true, endAt: true },
  });
  const commitments: TjwCommitment[] = [];
  for (const t of tjwSpanning) {
    if (t.primaryDriverId) commitments.push({ driverId: t.primaryDriverId, startAt: t.startAt, endAt: t.endAt });
    if (t.secondaryDriverId) commitments.push({ driverId: t.secondaryDriverId, startAt: t.startAt, endAt: t.endAt });
  }

  // --- Trips already on a car today seed each driver's schedule (overlap + cap). ---
  const assignedToday = await prisma.booking.findMany({
    where: { status: { in: COMMITTED_STATUSES }, primaryDriverId: { not: null }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
    select: {
      id: true, startAt: true, endAt: true, jobType: true, primaryDriverId: true, secondaryDriverId: true,
      waitAtDestination: true, dropOffDone: true, pickupReturnTime: true,
    },
  });
  const existingByDriver = new Map<string, ScheduledTrip[]>();
  const addTrip = (
    driverId: string | null,
    t: {
      id: string; startAt: Date; endAt: Date; jobType: JobType;
      waitAtDestination: boolean; dropOffDone: Date | null; pickupReturnTime: string | null;
    },
  ) => {
    if (!driverId) return;
    const list = existingByDriver.get(driverId) ?? [];
    list.push({
      id: t.id, startAt: t.startAt, endAt: t.endAt, jobType: t.jobType,
      waitAtDestination: t.waitAtDestination, dropOffDone: t.dropOffDone, pickupReturnTime: t.pickupReturnTime,
    });
    existingByDriver.set(driverId, list);
  };
  for (const t of assignedToday) {
    addTrip(t.primaryDriverId, t);
    addTrip(t.secondaryDriverId, t);
  }

  const synthetic: SolverBookingInput = {
    bookingId: "sim",
    jobType,
    startAt,
    endAt,
    estimatedDistance: km,
    outOfProvince: false,
    submittedAt: new Date(),
    waitAtDestination,
    dropOffDone,
    pickupReturnTime: waitAtDestination ? null : pickupReturnStr,
  };

  const result = solveDay({
    date: dayStart,
    bookings: [synthetic],
    drivers: pairedDriverStates,
    dutyDriverId,
    activeTjwCommitments: commitments,
    existingByDriver,
  });

  const a = result.assignments.find((x) => x.bookingId === "sim");
  if (a) {
    const vehicleId = driverCar.get(a.primaryDriverId) ?? null;
    // A non-WERN job landing on the duty driver = the solver reclaimed the duty car.
    const reclaim = a.jobType !== "WERN" && dutyDriverId != null && a.primaryDriverId === dutyDriverId;
    return {
      ok: true,
      kind: reclaim ? "reclaim" : "fit",
      registrationNumber: vehicleId ? regByVehicle.get(vehicleId) ?? null : null,
      driverName: nameById.get(a.primaryDriverId) ?? null,
      secondaryDriverName: a.secondaryDriverId ? nameById.get(a.secondaryDriverId) ?? null : null,
      dutyDriverName,
      jobType: a.jobType,
    };
  }
  const o = result.overflows.find((x) => x.bookingId === "sim");
  return { ok: true, kind: "none", reason: o?.reason ?? "NO_SLOT", dutyDriverName, jobType };
}
