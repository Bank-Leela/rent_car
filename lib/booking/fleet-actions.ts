"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DriverPool, Role, VehicleType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DISPATCHABLE_STATUSES } from "@/lib/booking/booking-status";
import { requireRole } from "@/lib/auth-helpers";
import { isStationEmail } from "@/lib/auth/station";
import { logEvent } from "@/lib/booking/audit";
import type { ActionResult } from "@/lib/booking/actions";

// Backfill Driver profiles for DRIVER-role users that don't have one yet.
// Creating a user with the DRIVER role does NOT create the Driver row the
// scheduler/fleet needs, so a freshly-added driver is otherwise invisible.
// Running this from the fleet page closes the "add a driver" gap.
export async function provisionDriverProfilesAction(): Promise<ActionResult & { created?: number }> {
  await requireRole("ADMIN");
  const missing = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: Role.DRIVER } }, driverProfile: { is: null } },
    select: { id: true, email: true },
  });
  // The shared station kiosk is a DRIVER account but must NEVER become a
  // dispatchable pool driver — exclude it from profile provisioning.
  const provisionable = missing.filter((u) => !isStationEmail(u.email));
  if (provisionable.length === 0) return { ok: true, created: 0 };
  await prisma.driver.createMany({
    data: provisionable.map((u) => ({ userId: u.id, pool: DriverPool.PUBLIC })),
    skipDuplicates: true,
  });
  revalidatePath("/admin/fleet");
  revalidatePath("/admin/schedule");
  return { ok: true, created: provisionable.length };
}

// Set (or clear) a car's assigned driver. Enforces 1:1: if the driver is
// already on another car, that car is cleared first (a driver owns one car).
export async function setVehicleDriverAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const raw = String(formData.get("driverId") ?? "");
  const driverId = raw === "" ? null : raw;
  if (!vehicleId) return { ok: false, error: "invalidInput" };

  await prisma.$transaction((tx) => assignDriverTx(tx, vehicleId, driverId, session.user.id));

  revalidatePath("/admin/fleet");
  revalidatePath("/admin/schedule");
  return { ok: true };
}

const vehicleSpecSchema = z.object({
  vehicleId: z.string().min(1),
  type: z.nativeEnum(VehicleType),
  capacity: z.coerce.number().int().min(1).max(60),
});

const newVehicleSchema = z.object({
  registrationNumber: z.string().trim().min(1).max(20),
  type: z.nativeEnum(VehicleType),
  capacity: z.coerce.number().int().min(1).max(60),
  notes: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => v || null),
  // Optional: pair a driver in the same step as creating the car.
  driverId: z.string().trim().optional().or(z.literal("")).transform((v) => v || null),
});

// Point a driver at a car inside a transaction, honouring the 1:1 rule: the
// driver is first released from any other car (a driver owns at most one car).
//
// Audited: car=driver is the fleet's central invariant — who drives what decides
// what the scheduler may dispatch — and re-pairing left no trace at all, so a
// pairing that changed under someone could not be traced to a person or a time.
async function assignDriverTx(
  tx: Prisma.TransactionClient,
  vehicleId: string,
  driverId: string | null,
  actorUserId: string,
) {
  const before = await tx.vehicle.findUnique({
    where: { id: vehicleId },
    select: { assignedDriverId: true },
  });

  // The 1:1 rule silently un-pairs the driver's previous car; name it in the log
  // rather than leaving a car that quietly lost its driver unexplained.
  let releasedFromVehicleIds: string[] = [];
  if (driverId) {
    const others = await tx.vehicle.findMany({
      where: { assignedDriverId: driverId, id: { not: vehicleId } },
      select: { id: true },
    });
    releasedFromVehicleIds = others.map((v) => v.id);
    await tx.vehicle.updateMany({
      where: { assignedDriverId: driverId, id: { not: vehicleId } },
      data: { assignedDriverId: null },
    });
  }
  await tx.vehicle.update({ where: { id: vehicleId }, data: { assignedDriverId: driverId } });

  // Re-saving the same pairing changes nothing worth a row.
  if ((before?.assignedDriverId ?? null) === driverId && releasedFromVehicleIds.length === 0) return;
  await logEvent({
    actorUserId,
    entityType: "VEHICLE",
    entityId: vehicleId,
    action: driverId ? "VEHICLE_DRIVER_PAIRED" : "VEHICLE_DRIVER_UNPAIRED",
    metadata: {
      fromDriverId: before?.assignedDriverId ?? null,
      toDriverId: driverId,
      releasedFromVehicleIds,
    },
    tx,
  });
}

// Add a car to the fleet (Admin เพิ่มรถในระบบได้), optionally pairing a driver
// in the same step. Registration is unique; a dup is a friendly error.
export async function createVehicleAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const parsed = newVehicleSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { registrationNumber, type, capacity, notes, driverId } = parsed.data;
  const existing = await prisma.vehicle.findUnique({ where: { registrationNumber } });
  if (existing) return { ok: false, error: "vehicleRegTaken" };
  await prisma.$transaction(async (tx) => {
    const created = await tx.vehicle.create({ data: { registrationNumber, type, capacity, notes } });
    if (driverId) await assignDriverTx(tx, created.id, driverId, session.user.id);
  });
  revalidatePath("/admin/fleet");
  revalidatePath("/admin/schedule");
  return { ok: true };
}

// Update a car's physical spec (type + seat capacity). The seed shipped
// placeholders for the real fleet, so P'Top needs a UI to enter the true
// values; the booking-assign picker shows "registration · type · N seats".
export async function updateVehicleSpecAction(formData: FormData): Promise<ActionResult> {
  await requireRole("ADMIN");
  const parsed = vehicleSpecSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { vehicleId, type, capacity } = parsed.data;
  await prisma.vehicle.update({ where: { id: vehicleId }, data: { type, capacity } });
  revalidatePath("/admin/fleet");
  revalidatePath("/admin/schedule");
  return { ok: true };
}

// Remove a car. Hard-delete only when it carries no booking history (so no
// VehicleOccupancy rows exist to trip the FK restrict); otherwise deactivate
// so past trips keep their vehicle link. Releases its driver either way.
export async function removeVehicleAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  if (!vehicleId) return { ok: false, error: "invalidInput" };

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, assignedDriverId: true, _count: { select: { bookings: true } } },
  });
  if (!vehicle) return { ok: false, error: "vehicleNotFound" };

  // Refuse while the car still has work on it. Every board query filters on
  // `isActive: true`, so deactivating a car with future ASSIGNED trips made those
  // trips DISAPPEAR from the schedule while still assigned — the driver read as
  // free, จัด would not re-place work it cannot see, and nobody was told. The trips
  // have to be moved first; this action cannot decide where they should go.
  const liveTrips = await prisma.booking.count({
    where: {
      vehicleId,
      status: { in: DISPATCHABLE_STATUSES },
      endAt: { gte: new Date() },
    },
  });
  if (liveTrips > 0) {
    return { ok: false, error: "vehicleHasUpcomingTrips" };
  }

  if (vehicle._count.bookings === 0) {
    await prisma.vehicle.delete({ where: { id: vehicleId } });
  } else {
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { isActive: false, assignedDriverId: null } });
  }
  // Either path takes a car — and its driver's only car — out of the fleet.
  // A hard-deleted vehicle leaves no row to explain where it went.
  await logEvent({
    actorUserId: session.user.id,
    entityType: "VEHICLE",
    entityId: vehicleId,
    action: vehicle._count.bookings === 0 ? "VEHICLE_DELETED" : "VEHICLE_DEACTIVATED",
    metadata: { releasedDriverId: vehicle.assignedDriverId, bookingCount: vehicle._count.bookings },
  });
  revalidatePath("/admin/fleet");
  revalidatePath("/admin/schedule");
  return { ok: true };
}
