"use server";

import { revalidatePath } from "next/cache";
import { startOfDay } from "date-fns";
import type { BookingStatus, Prisma } from "@prisma/client";
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

/** Occurrences a carried-forward vendor may claim: approved and still car-less. */
const CARRY_FORWARD_STATUSES = ["APPROVED", "AWAITING_DOCUMENT", "OUTSOURCED"] as const;

/**
 * Drop a booking onto an external row → OUTSOURCED (off-algorithm): cleared of
 * car/driver, status OUTSOURCED, linked to the row, vendor = the row's label.
 *
 * For a RECURRING booking the vendor carries forward to the later occurrences.
 * A weekly trip hires the same coach company every week, but AdHocVehicle is
 * scoped to a single date (`date @db.Date`), so the later dates cannot share this
 * row — each needs its own row carrying the same label, cost and contact. Before
 * this, arranging a 3-week outside booking meant repeating the whole setup on
 * each date, and the two later dates sat in "ยังไม่ได้จัดรถ / ต้องจัดเอง" looking
 * unhandled.
 *
 * Only LATER occurrences, and only ones still without a car — an occurrence
 * already on a faculty car or already on its own vendor row is left exactly as
 * it is. Each date's row stays independently editable afterwards, so a week whose
 * driver changes is corrected on that date alone.
 */
export async function outsourceToRowAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  const rowId = String(formData.get("rowId") ?? "");
  if (!bookingId || !rowId) return { ok: false, error: "invalidInput" };
  const row = await prisma.adHocVehicle.findUnique({
    where: { id: rowId },
    select: { id: true, label: true, cost: true, note: true, contactName: true, contactPhone: true },
  });
  if (!row) return { ok: false, error: "invalidInput" };
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { status: true, startAt: true, recurrenceParentId: true, id: true },
  });
  if (!booking) return { ok: false, error: "bookingNotFound" };

  const attach = async (
    tx: Prisma.TransactionClient,
    id: string,
    fromStatus: BookingStatus,
    targetRowId: string,
  ) => {
    await tx.booking.update({
      where: { id },
      data: {
        status: "OUTSOURCED", adHocVehicleId: targetRowId,
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
      bookingId: id, actorUserId: session.user.id, fromStatus, toStatus: "OUTSOURCED",
      action: "BOOKING_OUTSOURCED", metadata: { row: row.label }, tx,
    });
  };

  // The series key: the parent IS an occurrence, so it is `recurrenceParentId ??
  // id` (see lib/booking/series.ts). A non-recurring booking is a series of one
  // and the query below simply returns nothing.
  const seriesKey = booking.recurrenceParentId ?? booking.id;
  const laterSiblings = await prisma.booking.findMany({
    where: {
      id: { not: bookingId },
      OR: [{ id: seriesKey }, { recurrenceParentId: seriesKey }],
      startAt: { gt: booking.startAt },
      status: { in: [...CARRY_FORWARD_STATUSES] },
      // Never displace an occurrence that already has an arrangement.
      primaryDriverId: null,
      vehicleId: null,
      adHocVehicleId: null,
    },
    orderBy: { startAt: "asc" },
    select: { id: true, status: true, startAt: true },
  });

  let carried = 0;
  await prisma.$transaction(async (tx) => {
    await attach(tx, bookingId, booking.status, rowId);

    for (const sib of laterSiblings) {
      const day = startOfDay(sib.startAt);
      // Reuse a row already hired from this vendor on that date rather than
      // adding a second identical row to the board.
      const existing = await tx.adHocVehicle.findFirst({
        where: { date: day, label: row.label },
        select: { id: true },
      });
      const targetId =
        existing?.id ??
        (
          await tx.adHocVehicle.create({
            data: {
              date: day,
              label: row.label,
              cost: row.cost,
              note: row.note,
              contactName: row.contactName,
              contactPhone: row.contactPhone,
            },
            select: { id: true },
          })
        ).id;
      await attach(tx, sib.id, sib.status, targetId);
      carried++;
    }
  });

  revalidatePath("/admin/schedule");
  revalidatePath("/admin");
  revalidatePath("/requester");
  return { ok: true, carriedForward: carried } as ActionResult & { carriedForward: number };
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
