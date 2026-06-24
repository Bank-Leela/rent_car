"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import type { ActionResult } from "@/lib/booking/actions";

function dayMidnight(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Add a per-day external/outside-driver row to the board.
export async function addAdHocRowAction(formData: FormData): Promise<ActionResult> {
  await requireRole("ADMIN");
  const date = dayMidnight(String(formData.get("date") ?? ""));
  const label = String(formData.get("label") ?? "").trim();
  const costRaw = String(formData.get("cost") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!date || !label) return { ok: false, error: "invalidInput" };
  const cost = costRaw === "" ? null : Number(costRaw);
  await prisma.adHocVehicle.create({
    data: { date, label, cost: cost != null && !Number.isNaN(cost) ? cost : null, note },
  });
  revalidatePath("/admin/schedule");
  return { ok: true };
}

// Remove an external row — its trips revert to the queue (un-outsourced).
export async function removeAdHocRowAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "invalidInput" };
  await prisma.$transaction(async (tx) => {
    const trips = await tx.booking.findMany({ where: { adHocVehicleId: id }, select: { id: true, status: true } });
    for (const t of trips) {
      await tx.booking.update({
        where: { id: t.id },
        data: { status: "APPROVED", adHocVehicleId: null, needsOutsourcing: false, outsourceVendor: null },
      });
      await logTransition({
        bookingId: t.id, actorUserId: session.user.id, fromStatus: t.status, toStatus: "APPROVED",
        action: "BOOKING_UNOUTSOURCED", tx,
      });
    }
    await tx.adHocVehicle.delete({ where: { id } });
  });
  revalidatePath("/admin/schedule");
  return { ok: true };
}

// Drop a booking onto an external row → OUTSOURCED (off-algorithm): cleared of
// car/driver, status OUTSOURCED, linked to the row, vendor = the row's label.
export async function outsourceToRowAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  const rowId = String(formData.get("rowId") ?? "");
  if (!bookingId || !rowId) return { ok: false, error: "invalidInput" };
  const row = await prisma.adHocVehicle.findUnique({ where: { id: rowId }, select: { id: true, label: true } });
  if (!row) return { ok: false, error: "invalidInput" };
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
  if (!booking) return { ok: false, error: "bookingNotFound" };
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "OUTSOURCED", adHocVehicleId: rowId,
        vehicleId: null, primaryDriverId: null, secondaryDriverId: null,
        needsOutsourcing: true, outsourceVendor: row.label,
      },
    });
    await logTransition({
      bookingId, actorUserId: session.user.id, fromStatus: booking.status, toStatus: "OUTSOURCED",
      action: "BOOKING_OUTSOURCED", metadata: { row: row.label }, tx,
    });
  });
  revalidatePath("/admin/schedule");
  return { ok: true };
}

// Drag an outsourced booking back off the row → APPROVED (returns to the queue).
// Lossy by design: an OUTSOURCED trip was fully handed off (car/drivers cleared),
// so un-outsourcing returns it to the queue for fresh matching — any prior
// assignment is not restored.
export async function unoutsourceAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return { ok: false, error: "invalidInput" };
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
  if (!booking) return { ok: false, error: "bookingNotFound" };
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "APPROVED", adHocVehicleId: null, needsOutsourcing: false, outsourceVendor: null },
    });
    await logTransition({
      bookingId, actorUserId: session.user.id, fromStatus: booking.status, toStatus: "APPROVED",
      action: "BOOKING_UNOUTSOURCED", tx,
    });
  });
  revalidatePath("/admin/schedule");
  return { ok: true };
}
