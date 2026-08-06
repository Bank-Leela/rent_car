"use server";

import { revalidatePath } from "next/cache";
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

const JOB_TYPES: JobType[] = ["NORMAL", "OT", "TJW", "WERN"];

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

// The synthetic job's inputs, kept so "book this slot" can persist exactly what was simulated.
type PlacementInputs = {
  jobType: JobType;
  startAt: Date;
  endAt: Date;
  km: number | null;
  waitAtDestination: boolean;
  dropOffDone: Date | null;
  pickupReturnTime: string | null;
  dayStart: Date;
};

type PlacementOutcome =
  | { ok: false; error: string }
  | { ok: true; kind: "none"; reason: OverflowReason | "NO_SLOT"; dutyDriverName: string | null; jobType: JobType }
  | {
      ok: true;
      kind: "fit" | "reclaim";
      primaryDriverId: string;
      secondaryDriverId: string | null;
      vehicleId: string | null;
      registrationNumber: string | null;
      driverName: string | null;
      secondaryDriverName: string | null;
      dutyDriverName: string | null;
      jobType: JobType;
      inputs: PlacementInputs;
    };

// What-if placement: feed one synthetic job through the SAME solver the daily batch
// uses (solveDay), against the chosen day's live drivers / rotation / duty / committed
// bookings / TJW away-locks. Read-only here — returns the chosen slot's IDs + names, or
// the overflow reason. Shared by the preview (simulatePlacementAction) and the persist
// (bookSimulatedSlotAction). Mirrors batch-actions.runBatchAction.
async function runPlacement(formData: FormData): Promise<PlacementOutcome> {
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

  const startAt = new Date(`${dateStr}T${startStr}:00`);
  const endAt = new Date(`${dateStr}T${endStr}:00`);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) return { ok: false, error: "invalidTime" };
  if (endAt <= startAt) return { ok: false, error: "endBeforeStart" };

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

  const drivers = await prisma.driver.findMany({
    where: { isActive: true, user: { is: { isActive: true } }, unavailabilities: { none: { date: dayStart } } },
    select: {
      id: true, lastTjwAt: true, lastOtAt: true, lastDutyAt: true, lastAssignedAt: true,
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

  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    select: { id: true, registrationNumber: true, assignedDriverId: true },
  });
  const driverCar = driverVehicleMap(vehicles);
  const regByVehicle = new Map(vehicles.map((v) => [v.id, v.registrationNumber]));
  const pairedDriverStates = driverStates.filter((d) => driverCar.has(d.driverId));
  if (pairedDriverStates.length === 0) return { ok: false, error: "noDrivers" };

  const onCall = await prisma.onCallShift.findUnique({ where: { date: dayStart }, select: { driverId: true } });
  const dutyDriverId =
    onCall?.driverId && pairedDriverStates.some((d) => d.driverId === onCall.driverId) ? onCall.driverId : null;
  const dutyDriverName = dutyDriverId ? nameById.get(dutyDriverId) ?? null : null;

  const tjwSpanning = await prisma.booking.findMany({
    where: { jobType: "TJW", status: { in: COMMITTED_STATUSES }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
    select: { primaryDriverId: true, secondaryDriverId: true, startAt: true, endAt: true },
  });
  const commitments: TjwCommitment[] = [];
  for (const t of tjwSpanning) {
    if (t.primaryDriverId) commitments.push({ driverId: t.primaryDriverId, startAt: t.startAt, endAt: t.endAt });
    if (t.secondaryDriverId) commitments.push({ driverId: t.secondaryDriverId, startAt: t.startAt, endAt: t.endAt });
  }

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
    t: { id: string; startAt: Date; endAt: Date; jobType: JobType; waitAtDestination: boolean; dropOffDone: Date | null; pickupReturnTime: string | null },
  ) => {
    if (!driverId) return;
    const list = existingByDriver.get(driverId) ?? [];
    list.push({ id: t.id, startAt: t.startAt, endAt: t.endAt, jobType: t.jobType, waitAtDestination: t.waitAtDestination, dropOffDone: t.dropOffDone, pickupReturnTime: t.pickupReturnTime });
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
    const reclaim = a.jobType !== "WERN" && dutyDriverId != null && a.primaryDriverId === dutyDriverId;
    return {
      ok: true,
      kind: reclaim ? "reclaim" : "fit",
      primaryDriverId: a.primaryDriverId,
      secondaryDriverId: a.secondaryDriverId,
      vehicleId,
      registrationNumber: vehicleId ? regByVehicle.get(vehicleId) ?? null : null,
      driverName: nameById.get(a.primaryDriverId) ?? null,
      secondaryDriverName: a.secondaryDriverId ? nameById.get(a.secondaryDriverId) ?? null : null,
      dutyDriverName,
      jobType: a.jobType,
      inputs: { jobType, startAt, endAt, km, waitAtDestination, dropOffDone, pickupReturnTime: waitAtDestination ? null : pickupReturnStr, dayStart },
    };
  }
  const o = result.overflows.find((x) => x.bookingId === "sim");
  return { ok: true, kind: "none", reason: o?.reason ?? "NO_SLOT", dutyDriverName, jobType };
}

// Read-only preview — nothing is written. Surfaces the slot auto-assign would pick.
export async function simulatePlacementAction(formData: FormData): Promise<SimResult> {
  await requireRole("ADMIN");
  const r = await runPlacement(formData);
  if (!r.ok) return r;
  if (r.kind === "none") return { ok: true, kind: "none", reason: r.reason, dutyDriverName: r.dutyDriverName, jobType: r.jobType };
  return {
    ok: true,
    kind: r.kind,
    registrationNumber: r.registrationNumber,
    driverName: r.driverName,
    secondaryDriverName: r.secondaryDriverName,
    dutyDriverName: r.dutyDriverName,
    jobType: r.jobType,
  };
}

export type BookSlotResult = { ok: true; jobNumber: string } | { ok: false; error: string };

// Commit a simulated placement: re-run the placement against the CURRENT schedule, then
// create a real ASSIGNED booking on the chosen car/driver so it shows on จัดรอบ + schedule.
// The simulator doesn't collect requester/destination/passengers, so those default (admin
// as requester, "[จำลอง]"-marked purpose) — the booking is identifiable and cancelable.
export async function bookSimulatedSlotAction(formData: FormData): Promise<BookSlotResult> {
  const session = await requireRole("ADMIN");
  const r = await runPlacement(formData);
  if (!r.ok) return r;
  if (r.kind === "none") return { ok: false, error: r.reason };
  if (!r.vehicleId) return { ok: false, error: "NO_SLOT" };

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, departmentId: true },
  });
  const deptId = me?.departmentId ?? (await prisma.department.findFirst({ select: { id: true } }))?.id;
  if (!me || !deptId) return { ok: false, error: "noDepartment" };

  const i = r.inputs;
  const ym = `VB-${i.dayStart.getFullYear()}${String(i.dayStart.getMonth() + 1).padStart(2, "0")}`;
  const peers = await prisma.booking.findMany({ where: { jobNumber: { startsWith: ym } }, select: { jobNumber: true } });
  const next = peers.map((p) => Number(p.jobNumber.split("-").pop() ?? 0)).reduce((mx, n) => (n > mx ? n : mx), 0) + 1;
  const jobNumber = `${ym}-${next}`;
  const h = i.startAt.getHours();
  const timeBucket = h < 8 ? "BEFORE_08" : h < 12 ? "MORNING_08_12" : h < 16 ? "AFTERNOON_12_16" : "AFTER_16";
  const stamp = i.startAt;
  const stampData: { lastAssignedAt: Date; lastTjwAt?: Date; lastOtAt?: Date; lastDutyAt?: Date } = { lastAssignedAt: stamp };
  if (i.jobType === "TJW") stampData.lastTjwAt = stamp;
  else if (i.jobType === "OT") stampData.lastOtAt = stamp;
  else if (i.jobType === "WERN") stampData.lastDutyAt = stamp;

  await prisma.$transaction(async (tx) => {
    await tx.booking.create({
      data: {
        jobNumber,
        requesterId: me.id,
        departmentId: deptId,
        purpose: `[จำลอง] ${i.jobType}`,
        destination: "(จำลอง / simulator)",
        province: "กรุงเทพมหานคร",
        startAt: i.startAt,
        endAt: i.endAt,
        passengerCount: 1,
        ajarnName: me.name ?? "-",
        ajarnPhone: "-",
        ajarnEmail: me.email ?? "sim@chula.ac.th",
        status: "ASSIGNED",
        driverScheduleStatus: "CONFIRMED",
        decidedAt: new Date(),
        jobType: i.jobType,
        timeBucket,
        outOfProvince: false,
        estimatedDistance: i.km,
        waitAtDestination: i.waitAtDestination,
        dropOffDone: i.dropOffDone,
        pickupReturnTime: i.pickupReturnTime,
        vehicleId: r.vehicleId,
        primaryDriverId: r.primaryDriverId,
        secondaryDriverId: r.secondaryDriverId,
      },
    });
    await tx.driver.update({ where: { id: r.primaryDriverId }, data: stampData });
    if (r.secondaryDriverId) {
      const co: typeof stampData = { lastAssignedAt: stamp };
      if (i.jobType === "TJW") co.lastTjwAt = stamp;
      await tx.driver.update({ where: { id: r.secondaryDriverId }, data: co });
    }
  });

  revalidatePath("/admin/schedule");
  revalidatePath("/admin/batch");
  return { ok: true, jobNumber };
}
