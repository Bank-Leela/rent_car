"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import type { ActionResult } from "@/lib/booking/actions";

// Drag-and-drop on the schedule board: move a booking onto a car row. Sets the
// vehicle and flips an APPROVED booking to ASSIGNED. Driver is left as-is (P'Top
// can match later). Deliberately light — manual override of the auto matcher.
export async function reassignVehicleAction(formData: FormData): Promise<ActionResult> {
  await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  if (!bookingId || !vehicleId) return { ok: false, error: "invalidInput" };

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "bookingNotFound" };

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      vehicleId,
      status: booking.status === "APPROVED" ? "ASSIGNED" : booking.status,
      decidedAt: new Date(),
    },
  });

  revalidatePath("/admin/schedule");
  return { ok: true };
}
