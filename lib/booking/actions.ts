"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, type BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole, requireUser } from "@/lib/auth-helpers";
import { newBookingSchema, assignBookingSchema, denyBookingSchema } from "@/lib/booking/schema";
import { nextJobNumber } from "@/lib/booking/job-number";
import {
  checkLeadTime,
  checkDriverAssignment,
  findBufferConflicts,
  isBlockedByPendingEvaluation,
} from "@/lib/booking/rules";
import { sendEmail } from "@/lib/email/client";
import {
  adminNewBookingEmail,
  requesterAssignedEmail,
  requesterDeniedEmail,
} from "@/lib/email/templates";
import { sendLineNotification } from "@/lib/line/client";
import { buildRrule, expandRecurringDates } from "@/lib/booking/recurrence";

const bookingDetailInclude = {
  requester: true,
  department: true,
  vehicle: true,
  primaryDriver: { include: { user: true } },
  secondaryDriver: { include: { user: true } },
} as const;

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

async function logTransition(args: {
  bookingId: string;
  actorUserId: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus | null;
  action: string;
  metadata?: Prisma.InputJsonValue;
  tx?: Prisma.TransactionClient;
}) {
  const client = args.tx ?? prisma;
  await client.auditLog.create({
    data: {
      bookingId: args.bookingId,
      actorUserId: args.actorUserId,
      fromStatus: args.fromStatus,
      toStatus: args.toStatus,
      action: args.action,
      metadata: args.metadata,
    },
  });
}

// ---- Create booking ----

export async function createBookingAction(formData: FormData): Promise<ActionResult | void> {
  const session = await requireUser();
  const userId = session.user.id;

  const parsed = newBookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Invalid input", field: first?.path.join(".") };
  }
  const data = parsed.data;

  const lead = checkLeadTime({ startAt: data.startAt, province: data.province, now: new Date() });
  if (!lead.ok) {
    return {
      ok: false,
      field: "startAt",
      error: `Start must be at least ${lead.minimumDays} days from today (province rule).`,
    };
  }

  // Evaluation gate: prior unevaluated COMPLETED trips block new bookings.
  const pendingEvals = await prisma.trip.count({
    where: {
      booking: { requesterId: userId, status: "COMPLETED" },
      evaluation: null,
    },
  });
  if (isBlockedByPendingEvaluation(pendingEvals)) {
    return {
      ok: false,
      error: "You have a completed trip without an evaluation. Submit it before booking again.",
    };
  }

  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { departmentId: true },
  });
  if (!requester.departmentId) {
    return { ok: false, error: "Your account is not attached to a department." };
  }

  const created = await prisma.$transaction(async (tx) => {
    const jobNumber = await nextJobNumber(tx);
    const parent = await tx.booking.create({
      data: {
        jobNumber,
        requesterId: userId,
        departmentId: requester.departmentId!,
        purpose: data.purpose,
        destination: data.destination,
        province: data.province,
        startAt: data.startAt,
        endAt: data.endAt,
        passengerCount: data.passengerCount,
        passengerNotes: data.passengerNotes,
        estimatedDistance: data.estimatedDistance,
        needsOutsourcing: data.needsOutsourcing,
        status: "PENDING_APPROVAL",
      },
    });
    await logTransition({
      bookingId: parent.id,
      actorUserId: userId,
      fromStatus: null,
      toStatus: "PENDING_APPROVAL",
      action: "BOOKING_SUBMITTED",
      tx,
    });

    // Recurrence (Phase 5): expand weekdays + until date into child bookings.
    if (data.recurringWeekdays.length > 0 && data.recurringUntil) {
      const trip = data.endAt.getTime() - data.startAt.getTime();
      const dates = expandRecurringDates({
        startDate: data.startAt,
        endDate: data.recurringUntil,
        weekdays: data.recurringWeekdays,
      });
      // Skip the parent's own date — it's already created.
      const childDates = dates.filter((d) => d.toDateString() !== data.startAt.toDateString());
      await tx.recurrenceRule.create({
        data: {
          parentBookingId: parent.id,
          rrule: buildRrule(data.recurringWeekdays),
          startDate: data.startAt,
          endDate: data.recurringUntil,
        },
      });
      let seq = 1;
      for (const d of childDates) {
        const childStart = new Date(d);
        childStart.setHours(data.startAt.getHours(), data.startAt.getMinutes(), 0, 0);
        const childEnd = new Date(childStart.getTime() + trip);
        const childJob = await nextJobNumber(tx);
        const child = await tx.booking.create({
          data: {
            jobNumber: childJob,
            requesterId: userId,
            departmentId: requester.departmentId!,
            purpose: data.purpose,
            destination: data.destination,
            province: data.province,
            startAt: childStart,
            endAt: childEnd,
            passengerCount: data.passengerCount,
            passengerNotes: data.passengerNotes,
            estimatedDistance: data.estimatedDistance,
            needsOutsourcing: data.needsOutsourcing,
            status: "PENDING_APPROVAL",
            recurrenceParentId: parent.id,
          },
        });
        await logTransition({
          bookingId: child.id,
          actorUserId: userId,
          fromStatus: null,
          toStatus: "PENDING_APPROVAL",
          action: "BOOKING_SUBMITTED",
          metadata: { recurrenceParentId: parent.id, occurrence: seq },
          tx,
        });
        seq += 1;
      }
    }

    return parent;
  });

  const detailed = await prisma.booking.findUniqueOrThrow({
    where: { id: created.id },
    include: bookingDetailInclude,
  });

  // Phase 2: notify the department head + their delegate (not admins; admins
  // see the booking only after it's approved).
  const dept = await prisma.department.findUnique({
    where: { id: requester.departmentId! },
    select: {
      head: { select: { email: true, delegatedTo: { select: { email: true } } } },
    },
  });
  const approverEmails = [dept?.head?.email, dept?.head?.delegatedTo?.email]
    .filter((e): e is string => !!e);
  if (approverEmails.length > 0) {
    await sendEmail({ to: approverEmails, ...adminNewBookingEmail(detailed) });
  }

  revalidatePath("/requester");
  revalidatePath("/approver");
  redirect(`/requester/${created.id}`);
}

// ---- Admin: assign vehicle + driver ----

export async function assignBookingAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;

  const parsed = assignBookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Invalid input", field: first?.path.join(".") };
  }
  const data = parsed.data;

  const booking = await prisma.booking.findUnique({
    where: { id: data.bookingId },
  });
  if (!booking) return { ok: false, error: "Booking not found" };
  // Phase 2: admin only assigns after department-head approval.
  if (booking.status !== "APPROVED") {
    return { ok: false, error: `Cannot assign a booking in status ${booking.status}` };
  }

  // Two-driver rule.
  const driverCheck = checkDriverAssignment({
    estimatedDistance: booking.estimatedDistance,
    primaryDriverId: data.primaryDriverId,
    secondaryDriverId: data.secondaryDriverId ?? null,
  });
  if (!driverCheck.ok) {
    const messages = {
      PRIMARY_REQUIRED: "Pick a primary driver",
      SECONDARY_REQUIRED: "Trips over 400 km require a co-driver",
      DUPLICATE_DRIVER: "Primary and co-driver cannot be the same person",
    } as const;
    return { ok: false, error: messages[driverCheck.reason] };
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
    return {
      ok: false,
      field: "vehicleId",
      error: `That vehicle has a conflicting booking within the 1-hour buffer.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: data.bookingId },
      data: {
        vehicleId: data.vehicleId,
        primaryDriverId: data.primaryDriverId,
        secondaryDriverId: data.secondaryDriverId,
        status: "ASSIGNED",
        decidedAt: new Date(),
      },
    });
    await logTransition({
      bookingId: data.bookingId,
      actorUserId: adminId,
      fromStatus: booking.status,
      toStatus: "ASSIGNED",
      action: "BOOKING_ASSIGNED",
      metadata: {
        vehicleId: data.vehicleId,
        primaryDriverId: data.primaryDriverId,
        secondaryDriverId: data.secondaryDriverId ?? null,
      },
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
  // LINE notification to drivers (stub today; real client in Phase 5).
  for (const drv of [detailed.primaryDriver, detailed.secondaryDriver]) {
    if (drv?.user.lineUserId) {
      await sendLineNotification({
        toLineUserId: drv.user.lineUserId,
        message: `New trip assigned: ${detailed.jobNumber} · ${detailed.destination} · ${detailed.startAt.toISOString()}`,
        context: { bookingId: detailed.id, kind: "ASSIGNED" },
      });
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/${data.bookingId}`);
  revalidatePath("/requester");
  revalidatePath(`/requester/${data.bookingId}`);
  revalidatePath("/driver");
  return { ok: true };
}

// ---- Admin: deny ----

export async function denyBookingAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("ADMIN");
  const adminId = session.user.id;

  const parsed = denyBookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { bookingId, reason } = parsed.data;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (booking.status === "DENIED" || booking.status === "CANCELLED" || booking.status === "COMPLETED") {
    return { ok: false, error: `Cannot deny a booking in status ${booking.status}` };
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
