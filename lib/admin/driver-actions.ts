"use server";

import { revalidatePath } from "next/cache";
import { Prisma, DriverPool, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";

export type DriverActionResult = { ok: true } | { ok: false; error: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const strOrNull = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? null : v;
};

// Admin edits a driver's roster information + their car assignment. Name/thaiName/
// phone live on User; the roster fields live on Driver. Reassigning the car follows
// the car=driver 1:1 model (Vehicle.assignedDriverId is @unique).
export async function adminUpdateDriverAction(formData: FormData): Promise<DriverActionResult> {
  await requireRole("ADMIN");

  const driverId = str(formData, "driverId");
  if (!driverId) return { ok: false, error: "invalidInput" };

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, userId: true, assignedVehicle: { select: { id: true } } },
  });
  if (!driver) return { ok: false, error: "driverNotFound" };

  const name = strOrNull(formData, "name");
  if (!name) return { ok: false, error: "invalidInput" };
  const thaiName = strOrNull(formData, "thaiName");
  const phone = strOrNull(formData, "phone");
  const nickname = strOrNull(formData, "nickname");
  const licenseType = strOrNull(formData, "licenseType");
  const licenseNumber = strOrNull(formData, "licenseNumber");
  const position = strOrNull(formData, "position");
  const notes = strOrNull(formData, "notes");
  const isActive = str(formData, "isActive") === "true";

  let licenseExpiresAt: Date | null = null;
  const licenseExpiresStr = str(formData, "licenseExpiresAt");
  if (licenseExpiresStr) {
    const d = new Date(licenseExpiresStr);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "invalidInput" };
    licenseExpiresAt = d;
  }

  let retirementYear: number | null = null;
  const retStr = str(formData, "retirementYear");
  if (retStr) {
    const n = Number(retStr);
    // Thai BE year as shown on the sheet (e.g. 2569).
    if (!Number.isInteger(n) || n < 2400 || n > 2700) return { ok: false, error: "invalidInput" };
    retirementYear = n;
  }

  // Admin-defined extra fields: a JSON array of { label, value } from the form.
  // Rows with a blank label are dropped; null when none remain.
  let customFields: { label: string; value: string }[] | null = null;
  const customStr = str(formData, "customFields");
  if (customStr) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(customStr);
    } catch {
      return { ok: false, error: "invalidInput" };
    }
    if (!Array.isArray(parsed)) return { ok: false, error: "invalidInput" };
    const rows: { label: string; value: string }[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) return { ok: false, error: "invalidInput" };
      const label = String((item as Record<string, unknown>).label ?? "").trim();
      const value = String((item as Record<string, unknown>).value ?? "").trim();
      if (label) rows.push({ label, value });
    }
    customFields = rows.length ? rows : null;
  }

  // "" = unassign the driver's car. A vehicleId must exist.
  const vehicleId = strOrNull(formData, "vehicleId");
  if (vehicleId) {
    const v = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, assignedDriverId: true },
    });
    if (!v) return { ok: false, error: "invalidInput" };
    // Don't silently steal another driver's car (that would orphan them and they
    // can no longer be dispatched). Admin must unassign the other driver first.
    if (v.assignedDriverId && v.assignedDriverId !== driver.id) {
      return { ok: false, error: "vehicleAssignedElsewhere" };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: driver.userId }, data: { name, thaiName, phone } });
    await tx.driver.update({
      where: { id: driver.id },
      data: {
        nickname, licenseType, licenseNumber, position, notes, isActive, licenseExpiresAt, retirementYear,
        customFields: customFields ?? Prisma.DbNull,
      },
    });
    // Clear this driver's current car first so the assignedDriverId @unique never
    // double-binds, then point the chosen car at this driver (moving it off any
    // prior holder). Skip when the chosen car is already this driver's.
    if (driver.assignedVehicle && driver.assignedVehicle.id !== vehicleId) {
      await tx.vehicle.update({ where: { id: driver.assignedVehicle.id }, data: { assignedDriverId: null } });
    }
    if (vehicleId && driver.assignedVehicle?.id !== vehicleId) {
      await tx.vehicle.update({ where: { id: vehicleId }, data: { assignedDriverId: driver.id } });
    }
  });

  revalidatePath("/admin/drivers");
  revalidatePath(`/admin/drivers/${driverId}`);
  revalidatePath("/admin/schedule");
  return { ok: true };
}

// Admin adds a driver. Drivers sign in only via the shared station kiosk, so no
// individual login is provisioned — we still create a backing User to hold the
// roster identity (name/phone), with a synthetic unique email that never logs in.
export async function adminCreateDriverAction(formData: FormData): Promise<DriverActionResult> {
  await requireRole("ADMIN");

  const name = strOrNull(formData, "name");
  if (!name) return { ok: false, error: "invalidInput" };
  const thaiName = strOrNull(formData, "thaiName");
  const nickname = strOrNull(formData, "nickname");
  const phone = strOrNull(formData, "phone");
  const poolStr = str(formData, "pool") || "PUBLIC";
  if (poolStr !== "PUBLIC" && poolStr !== "PRIVATE") return { ok: false, error: "invalidInput" };

  await prisma.user.create({
    data: {
      // Synthetic, non-login identity. .invalid is reserved (RFC 2606) so it can
      // never collide with a real mailbox or be used for recovery.
      email: `driver-${crypto.randomUUID()}@fleet.invalid`,
      name,
      thaiName,
      phone,
      roles: { create: { role: Role.DRIVER } },
      driverProfile: { create: { pool: poolStr as DriverPool, nickname } },
    },
  });

  revalidatePath("/admin/drivers");
  revalidatePath("/admin/fleet");
  revalidatePath("/admin/schedule");
  return { ok: true };
}

// Admin removes a driver. Hard-delete (driver + its synthetic user) only when the
// driver has no trip history; otherwise deactivate so past bookings keep their
// driver link. Releases any assigned car first so it returns to the pool.
export async function adminRemoveDriverAction(formData: FormData): Promise<DriverActionResult> {
  await requireRole("ADMIN");
  const driverId = str(formData, "driverId");
  if (!driverId) return { ok: false, error: "invalidInput" };

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      id: true,
      userId: true,
      assignedVehicle: { select: { id: true } },
      _count: { select: { primaryBookings: true, secondaryBookings: true, claims: true } },
    },
  });
  if (!driver) return { ok: false, error: "driverNotFound" };

  const hasHistory =
    driver._count.primaryBookings + driver._count.secondaryBookings + driver._count.claims > 0;

  await prisma.$transaction(async (tx) => {
    if (driver.assignedVehicle) {
      await tx.vehicle.update({ where: { id: driver.assignedVehicle.id }, data: { assignedDriverId: null } });
    }
    if (hasHistory) {
      await tx.driver.update({ where: { id: driver.id }, data: { isActive: false } });
      await tx.user.update({ where: { id: driver.userId }, data: { isActive: false } });
    } else {
      // Deleting the user cascades to the Driver profile (onDelete: Cascade).
      await tx.user.delete({ where: { id: driver.userId } });
    }
  });

  revalidatePath("/admin/drivers");
  revalidatePath("/admin/fleet");
  revalidatePath("/admin/schedule");
  return { ok: true };
}
