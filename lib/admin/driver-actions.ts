"use server";

import { revalidatePath } from "next/cache";
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

  // "" = unassign the driver's car. A vehicleId must exist.
  const vehicleId = strOrNull(formData, "vehicleId");
  if (vehicleId) {
    const v = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } });
    if (!v) return { ok: false, error: "invalidInput" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: driver.userId }, data: { name, thaiName, phone } });
    await tx.driver.update({
      where: { id: driver.id },
      data: { nickname, licenseType, licenseNumber, position, notes, isActive, licenseExpiresAt, retirementYear },
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

// Admin sets a driver's login username. Admin changes are unrestricted (the
// self-service once-limit applies only to users editing their own account).
export async function adminSetDriverUsernameAction(formData: FormData): Promise<DriverActionResult> {
  await requireRole("ADMIN");

  const driverId = str(formData, "driverId");
  const username = str(formData, "username").toLowerCase();
  if (!driverId) return { ok: false, error: "invalidInput" };
  if (!/^[a-z0-9._]{3,40}$/.test(username)) return { ok: false, error: "invalidUsername" };

  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
  if (!driver) return { ok: false, error: "driverNotFound" };

  const taken = await prisma.user.findFirst({
    where: { username, NOT: { id: driver.userId } },
    select: { id: true },
  });
  if (taken) return { ok: false, error: "usernameTaken" };

  await prisma.user.update({
    where: { id: driver.userId },
    data: { username, usernameChangedAt: new Date() },
  });
  revalidatePath("/admin/drivers");
  revalidatePath(`/admin/drivers/${driverId}`);
  return { ok: true };
}
