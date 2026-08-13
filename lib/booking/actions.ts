"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { assignBookingSchema, denyBookingSchema } from "@/lib/booking/schema";
import { findBufferConflicts } from "@/lib/booking/rules";
import { sendEmail } from "@/lib/email/client";
import { requesterAssignedEmail, requesterDeniedEmail } from "@/lib/email/templates";
import { bookingDetailInclude } from "@/lib/booking/booking-detail-include";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";
import { isExclusionViolation } from "@/lib/booking/db-errors";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

// Requester-facing booking submission lives in ./create-booking-action, which
// imports ActionResult from here and bookingDetailInclude from
// ./booking-detail-include (plain data can't be exported from a "use server"
// file — every export there must be an async function).

// ---- Admin: allow + allocate vehicle (CR-02: drivers are no longer assigned
// by the admin; they self-claim on the driver schedule board). ----

export async function assignBookingAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = assignBookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? te("invalidInput"), field: first?.path.join(".") };
  }
  const data = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: data.bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.status !== "APPROVED") {
    return { ok: false, error: te("cannotAssignInStatus", { status: ts(booking.status) }) };
  }

  // 1-hour buffer rule against other confirmed bookings on the same vehicle.
  //
  // COMMITTED_STATUSES, not ["APPROVED","ASSIGNED"]. The occupancy trigger writes
  // its rows for APPROVED, ASSIGNED *and* COMPLETED, and the GiST EXCLUDE enforces
  // them, so a COMPLETED trip still holds its car for its original window —
  // completing early does not shorten it, because occupancy comes from
  // startAt/endAt and never from completedAt. Missing COMPLETED here meant this
  // pre-check passed a car the database would then refuse.
  const otherBookings = await prisma.booking.findMany({
    where: {
      vehicleId: data.vehicleId,
      status: { in: COMMITTED_STATUSES },
      id: { not: data.bookingId },
    },
    select: { id: true, startAt: true, endAt: true },
  });
  const conflicts = findBufferConflicts(
    { startAt: booking.startAt, endAt: booking.endAt },
    otherBookings,
  );
  if (conflicts.length > 0) {
    return { ok: false, field: "vehicleId", error: te("vehicleConflict") };
  }

  // CR-02: status stays APPROVED until drivers claim + the primary confirms.
  // Only the vehicle is set here; driver fields are touched via claim flow.
  //
  // The pre-check above is a read, so it can always lose a race to another admin
  // allocating the same car. The occupancy EXCLUDE is the real authority, and
  // without this catch its 23P01 escaped as an unhandled rejection: the admin
  // detail page was replaced wholesale by the error boundary while the allocation
  // silently failed. schedule-actions.ts already degrades the same violation to a
  // friendly result; this path had simply never been given the same treatment.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: data.bookingId },
        data: { vehicleId: data.vehicleId, decidedAt: new Date() },
      });
      await logTransition({
        bookingId: data.bookingId,
        actorUserId: adminId,
        fromStatus: booking.status,
        toStatus: booking.status,
        action: "VEHICLE_ALLOCATED",
        metadata: { vehicleId: data.vehicleId },
        tx,
      });
    });
  } catch (err) {
    if (!isExclusionViolation(err)) throw err;
    return { ok: false, field: "vehicleId", error: te("vehicleConflict") };
  }

  const detailed = await prisma.booking.findUniqueOrThrow({
    where: { id: data.bookingId },
    include: bookingDetailInclude,
  });
  if (detailed.requester.email) {
    await sendEmail({ to: detailed.requester.email, ...requesterAssignedEmail(detailed) });
  }
  // CR-02: admin no longer pings drivers — they self-organize on the board.

  revalidatePath("/admin");
  revalidatePath(`/admin/${data.bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${data.bookingId}`);
  return { ok: true };
}

// ---- Admin: deny ----

export async function denyBookingAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = denyBookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  }
  const { bookingId, reason } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.status === "DENIED" || booking.status === "CANCELLED" || booking.status === "COMPLETED") {
    return { ok: false, error: te("cannotDenyInStatus", { status: ts(booking.status) }) };
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: "DENIED", denialReason: reason, decidedAt: new Date() },
    });
    await logTransition({
      bookingId,
      actorUserId: adminId,
      fromStatus: booking.status,
      toStatus: "DENIED",
      action: "BOOKING_DENIED",
      metadata: { reason },
      tx,
    });
  });

  const detailed = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: bookingDetailInclude,
  });
  if (detailed.requester.email) {
    await sendEmail({ to: detailed.requester.email, ...requesterDeniedEmail(detailed, reason) });
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}
