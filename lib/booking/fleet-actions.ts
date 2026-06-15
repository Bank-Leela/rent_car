"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import type { ActionResult } from "@/lib/booking/actions";

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
