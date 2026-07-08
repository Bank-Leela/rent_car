"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DriverPool, Role, VehicleType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { isStationEmail } from "@/lib/auth/station";
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
  await requireRole("ADMIN");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const raw = String(formData.get("driverId") ?? "");
  const driverId = raw === "" ? null : raw;
  if (!vehicleId) return { ok: false, error: "invalidInput" };

  await prisma.$transaction(async (tx) => {
    if (driverId) {
      // 1:1 — release the driver from any other car first.
      await tx.vehicle.updateMany({
        where: { assignedDriverId: driverId, id: { not: vehicleId } },
        data: { assignedDriverId: null },
      });
    }
    await tx.vehicle.update({ where: { id: vehicleId }, data: { assignedDriverId: driverId } });
  });

  revalidatePath("/admin/fleet");
  revalidatePath("/admin/schedule");
  return { ok: true };
}

const vehicleSpecSchema = z.object({
  vehicleId: z.string().min(1),
  type: z.nativeEnum(VehicleType),
  capacity: z.coerce.number().int().min(1).max(60),
});

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
