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
  // Who the passengers ring on the day. Optional: a row is often created before
  // the vendor has said which driver is coming.
  const contactName = String(formData.get("contactName") ?? "").trim() || null;
  const contactPhone = String(formData.get("contactPhone") ?? "").trim() || null;
  if (!date || !label) return { ok: false, error: "invalidInput" };
  const cost = costRaw === "" ? null : Number(costRaw);
  await prisma.adHocVehicle.create({
    data: {
      date,
      label,
      cost: cost != null && !Number.isNaN(cost) ? cost : null,
      note,
      contactName,
      contactPhone,
    },
  });
  revalidatePath("/admin/schedule");
  return { ok: true };
}

/**
 * Set (or change) the contact on an existing outside-vehicle row.
 *
 * Needed because a row is normally created before the vendor has said who is
 * driving. Without this the only way to add a contact would be to delete the row
 * and make it again — and deleting a row un-outsources every trip on it, so
 * filling in a phone number would silently undo the day's arrangements.
 *
 * The trips already attached are updated in the same transaction: they hold their
 * own copy (see outsourceToRowAction), so leaving them alone would show the
 * requester a blank contact while the board showed a filled one.
 */
export async function setAdHocContactAction(formData: FormData): Promise<ActionResult> {
  await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "invalidInput" };
  const contactName = String(formData.get("contactName") ?? "").trim() || null;
  const contactPhone = String(formData.get("contactPhone") ?? "").trim() || null;
  const row = await prisma.adHocVehicle.findUnique({ where: { id }, select: { id: true } });
  if (!row) return { ok: false, error: "invalidInput" };

  await prisma.$transaction(async (tx) => {
    await tx.adHocVehicle.update({ where: { id }, data: { contactName, contactPhone } });
    await tx.booking.updateMany({
      where: { adHocVehicleId: id, status: "OUTSOURCED" },
      data: { outsourceContactName: contactName, outsourceContactPhone: contactPhone },
    });
  });
  revalidatePath("/admin/schedule");
  revalidatePath("/admin");
  revalidatePath("/requester");
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
        data: {
          status: "APPROVED", adHocVehicleId: null, needsOutsourcing: false,
          // The whole outside-vehicle record goes with it — a stale contact on a
          // trip that came back in-house would name someone with no involvement.
          outsourceVendor: null, outsourceContactName: null, outsourceContactPhone: null,
        },
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
  const row = await prisma.adHocVehicle.findUnique({
    where: { id: rowId },
    select: { id: true, label: true, contactName: true, contactPhone: true },
  });
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
        // Copied down, not joined: the requester's page shows one contact per
        // booking, and the manual vendor form fills the same two columns — so
        // both routes to OUTSOURCED read the same way.
        outsourceContactName: row.contactName,
        outsourceContactPhone: row.contactPhone,
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
      data: {
          status: "APPROVED", adHocVehicleId: null, needsOutsourcing: false,
          // The whole outside-vehicle record goes with it — a stale contact on a
          // trip that came back in-house would name someone with no involvement.
          outsourceVendor: null, outsourceContactName: null, outsourceContactPhone: null,
        },
    });
    await logTransition({
      bookingId, actorUserId: session.user.id, fromStatus: booking.status, toStatus: "APPROVED",
      action: "BOOKING_UNOUTSOURCED", tx,
    });
  });
  revalidatePath("/admin/schedule");
  return { ok: true };
}
