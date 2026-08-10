"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";
import type { TjwCommitment } from "@/lib/booking/batch-solver";
import { driverVehicleMap } from "@/lib/booking/fleet";
import { loadWeightedEarnings } from "@/lib/booking/earnings";
import type { DriverRotationState } from "@/lib/booking/rotations";
import { solveTjwByRequest, type TjwRequestInput } from "@/lib/booking/tjw-request-solver";

export type TjwAssignResult =
  | { ok: true; assigned: number; overflows: { bookingId: string; reason: string }[] }
  | { ok: false; error: string };

/**
 * New-algorithm variant: assign all pending TJW in GLOBAL request-date order
 * (earliest createdAt first), fairest eligible driver each. Already-assigned TJW
 * are fixed commitments (never moved). Mirrors runBatchAction's load → solve →
 * write/stamp, but for TJW only and across all days. See
 * docs/superpowers/specs/2026-06-26-tjw-request-order-assignment-design.md.
 */
export async function assignTjwByRequestOrder(): Promise<TjwAssignResult> {
  const session = await requireRole("ADMIN");
  const te = await getTranslations("errors");

  // Pending APPROVED + unassigned TJW, any day, in request order.
  const pending = await prisma.booking.findMany({
    where: { jobType: "TJW", status: "APPROVED", primaryDriverId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, startAt: true, endAt: true, estimatedDistance: true, needsSecondaryDriver: true },
  });
  if (pending.length === 0) return { ok: true, assigned: 0, overflows: [] };

  // Span of the pending set — bounds the commitment + duty queries below.
  const minStart = pending.reduce((m, b) => (b.startAt < m ? b.startAt : m), pending[0]!.startAt);
  const maxEnd = pending.reduce((m, b) => (b.endAt > m ? b.endAt : m), pending[0]!.endAt);

  // Active, car-paired drivers + rotation snapshot (no per-day unavailability
  // filter — a TJW spans days; per-day off-marks are a future refinement).
  const drivers = await prisma.driver.findMany({
    where: { isActive: true, user: { is: { isActive: true } } },
    select: { id: true, lastTjwAt: true, lastOtAt: true, lastDutyAt: true, lastAssignedAt: true },
  });
  if (drivers.length === 0) return { ok: false, error: te("noActiveDrivers") };
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
    select: { id: true, assignedDriverId: true },
  });
  const driverCar = driverVehicleMap(vehicles);

  // EVERY committed, driver-assigned trip overlapping the span → fixed commitment.
  // NOT just TJW: a driver already on a NORMAL/OT/WERN trip must block a TJW placed
  // over it (the solver's overlap check only sees what we load here). The span
  // bound keeps the row set small and drops trips that can't overlap any request.
  const committed = await prisma.booking.findMany({
    where: {
      status: { in: COMMITTED_STATUSES },
      primaryDriverId: { not: null },
      startAt: { lt: maxEnd },
      endAt: { gt: minStart },
    },
    select: { primaryDriverId: true, secondaryDriverId: true, startAt: true, endAt: true },
  });
  const existingCommitments: TjwCommitment[] = [];
  for (const t of committed) {
    if (t.primaryDriverId) existingCommitments.push({ driverId: t.primaryDriverId, startAt: t.startAt, endAt: t.endAt });
    if (t.secondaryDriverId) existingCommitments.push({ driverId: t.secondaryDriverId, startAt: t.startAt, endAt: t.endAt });
  }

  // Sick / leave days across the same span, as commitments the solver already
  // knows how to respect. Every other assignment path filters on
  // `unavailabilities: { none: … }`, but that is a per-DAY filter and a TJW spans
  // days, so this one was left unfiltered — a driver marked off Tuesday could
  // still be handed a Mon–Wed ตจว. Blocking the whole off-day is the correct
  // shape: any part of a trip touching it means they are not there for it.
  const offDays = await prisma.driverUnavailability.findMany({
    where: { date: { gte: startOfDay(minStart), lte: startOfDay(maxEnd) } },
    select: { driverId: true, date: true },
  });
  for (const o of offDays) {
    const from = startOfDay(o.date);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    existingCommitments.push({ driverId: o.driverId, startAt: from, endAt: to });
  }

  // Duty driver per day across the requested span (excluded from TJW on that day).
  const shifts = await prisma.onCallShift.findMany({
    where: { date: { gte: startOfDay(minStart), lte: startOfDay(maxEnd) } },
    select: { date: true, driverId: true },
  });
  const dutyByDay = new Map<number, string>(shifts.map((s) => [startOfDay(s.date).getTime(), s.driverId]));

  const requests: TjwRequestInput[] = pending.map((b) => ({
    bookingId: b.id,
    createdAt: b.createdAt,
    startAt: b.startAt,
    endAt: b.endAt,
    estimatedDistance: b.estimatedDistance,
    needsSecondaryDriver: b.needsSecondaryDriver,
  }));

  const result = solveTjwByRequest({
    requests,
    drivers: driverStates,
    driverCar,
    existingCommitments,
    dutyByDay,
  });

  await prisma.$transaction(async (tx) => {
    for (const a of result.assignments) {
      const vehicleId = driverCar.get(a.primaryDriverId)!; // solver only picks car-paired drivers
      const stamp = requests.find((r) => r.bookingId === a.bookingId)!.startAt;
      await tx.booking.update({
        where: { id: a.bookingId },
        data: {
          primaryDriverId: a.primaryDriverId,
          secondaryDriverId: a.secondaryDriverId,
          vehicleId,
          status: "ASSIGNED",
          driverScheduleStatus: "CONFIRMED",
          decidedAt: new Date(),
          overflowReason: null,
          escalatedToKhunTop: false,
        },
      });
      // Provisional rotation stamp (TJW): a re-run won't double-pick the driver.
      await tx.driver.update({
        where: { id: a.primaryDriverId },
        data: { lastTjwAt: stamp, lastAssignedAt: stamp },
      });
      if (a.secondaryDriverId) {
        await tx.driver.update({
          where: { id: a.secondaryDriverId },
          data: { lastTjwAt: stamp, lastAssignedAt: stamp },
        });
      }
      await logTransition({
        bookingId: a.bookingId,
        actorUserId: session.user.id,
        fromStatus: "APPROVED",
        toStatus: "ASSIGNED",
        action: "TJW_REQUEST_ORDER_MATCHED",
        metadata: {
          primaryDriverId: a.primaryDriverId,
          secondaryDriverId: a.secondaryDriverId,
          jobType: "TJW",
        },
        tx,
      });
    }
    for (const o of result.overflows) {
      await tx.booking.update({ where: { id: o.bookingId }, data: { overflowReason: o.reason } });
    }
  });

  revalidatePath("/admin");
  revalidatePath("/admin/batch");
  revalidatePath("/admin/schedule");

  return { ok: true, assigned: result.assignments.length, overflows: result.overflows };
}
