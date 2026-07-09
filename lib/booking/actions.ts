"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireRole, requireUser } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import {
  assignBookingSchema,
  denyBookingSchema,
  updateBookingTimeSchema,
} from "@/lib/booking/schema";
import { bucketFromStart } from "@/lib/booking/slot-allocation";
import { checkLeadTime, findBufferConflicts, isWithinWorkHours } from "@/lib/booking/rules";
import { sendEmail } from "@/lib/email/client";
import {
  adminTimeChangedEmail,
  requesterAssignedEmail,
  requesterDeniedEmail,
} from "@/lib/email/templates";
import { recomputeRotationStamp } from "@/lib/booking/rotation-stamp";

// Shared by every action's post-mutation notify/read-back. Exported for the
// requester-facing create action, split into ./create-booking-action.
export const bookingDetailInclude = {
  requester: true,
  department: true,
  vehicle: true,
  primaryDriver: { include: { user: true } },
  secondaryDriver: { include: { user: true } },
} as const;

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

// Requester-facing booking submission lives in ./create-booking-action, which
// imports ActionResult + bookingDetailInclude from here (one-directional).

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
  const otherBookings = await prisma.booking.findMany({
    where: {
      vehicleId: data.vehicleId,
      status: { in: ["APPROVED", "ASSIGNED"] },
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

// ---- Requester: change the trip time before approval ----

export async function updateBookingTimeAction(formData: FormData): Promise<ActionResult> {
  const session = await requireUser();
  const userId = session.user.id;
  const te = await getTranslations("errors");
  const ts = await getTranslations("status");

  const parsed = updateBookingTimeSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? te("invalidInput"), field: first?.path.join(".") };
  }
  const { bookingId, startAt, endAt, outOfHoursReason: submittedReason } = parsed.data;

  if (endAt.getTime() <= startAt.getTime()) {
    return { ok: false, field: "endAt", error: te("endBeforeStart") };
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: te("bookingNotFound") };
  if (booking.requesterId !== userId) {
    return { ok: false, error: te("notYourBooking") };
  }
  // Time edits are allowed until the trip actually runs. PENDING/APPROVED are
  // harmless (nothing dispatched yet). ASSIGNED is allowed too, but reverts the
  // booking to the APPROVED queue below — P'Top decides every assignment, so a
  // changed time must never keep a stale driver/vehicle.
  if (!["PENDING_APPROVAL", "APPROVED", "ASSIGNED"].includes(booking.status)) {
    return { ok: false, error: te("cannotEditInStatus", { status: ts(booking.status) }) };
  }
  if (booking.startAt.getTime() <= Date.now()) {
    return { ok: false, field: "startAt", error: te("cannotEditInStatus", { status: ts(booking.status) }) };
  }

  const lead = checkLeadTime({
    startAt,
    province: booking.province,
    urgent: booking.isEmergency,
    jobType: booking.jobType,
    now: new Date(),
  });
  if (!lead.ok) {
    return {
      ok: false,
      field: "startAt",
      error:
        booking.jobType === "SMUS"
          ? te("leadTimeTooSoonCalendar", { days: lead.minimumDays })
          : te("leadTimeTooSoon", { days: lead.minimumDays }),
    };
  }

  const inHours = isWithinWorkHours({ startAt, endAt });
  if (!inHours && !submittedReason) {
    return { ok: false, field: "outOfHoursReason", error: te("outOfHoursReasonRequired") };
  }
  const outOfHoursReason = inHours ? null : submittedReason!;

  // An ASSIGNED trip loses its dispatch: new times may not suit the driver or
  // may overlap their other work, so the assignment is released and the trip
  // returns to the APPROVED queue for P'Top to re-place.
  const wasAssigned = booking.status === "ASSIGNED";
  const freedDrivers = wasAssigned
    ? [booking.primaryDriverId, booking.secondaryDriverId].filter((id): id is string => !!id)
    : [];

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        startAt,
        endAt,
        outOfHoursReason,
        timeBucket: bucketFromStart(startAt),
        ...(wasAssigned
          ? {
              vehicleId: null,
              primaryDriverId: null,
              secondaryDriverId: null,
              status: "APPROVED" as const,
              driverScheduleStatus: "UNCLAIMED" as const,
              decidedAt: null,
            }
          : {}),
      },
    });
    await logTransition({
      bookingId,
      actorUserId: userId,
      fromStatus: booking.status,
      toStatus: wasAssigned ? "APPROVED" : booking.status,
      action: "BOOKING_TIME_UPDATED",
      metadata: {
        previousStartAt: booking.startAt.toISOString(),
        previousEndAt: booking.endAt.toISOString(),
        newStartAt: startAt.toISOString(),
        newEndAt: endAt.toISOString(),
        outOfHoursReason: outOfHoursReason ?? null,
        ...(wasAssigned ? { assignmentReleased: true, freedDrivers } : {}),
      },
      tx,
    });
  });

  // Freed drivers' rotation stamps recompute from their remaining trips (same
  // rollback the cancel/unassign paths use). Runs on the ids captured BEFORE
  // the clear — the booking no longer references them.
  for (const driverId of freedDrivers) {
    await recomputeRotationStamp(driverId, booking.jobType);
  }

  // Heads-up so P'Top re-dispatches at the new time. Failure never blocks.
  if (wasAssigned) {
    try {
      const detailed = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: bookingDetailInclude,
      });
      const admins = await prisma.user.findMany({
        where: { roles: { some: { role: "ADMIN" } }, isActive: true },
        select: { email: true },
      });
      const to = admins.map((a) => a.email).filter((e): e is string => !!e);
      if (to.length > 0) await sendEmail({ to, ...adminTimeChangedEmail(detailed) });
    } catch (err) {
      console.error("[timeChange] admin notify failed", err);
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${bookingId}`);
  revalidatePath("/admin/schedule");
  revalidatePath("/requester");
  revalidatePath(`/requester/${bookingId}`);
  return { ok: true };
}
