"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { newBookingSchema } from "@/lib/booking/schema";
import { nextJobNumber } from "@/lib/booking/job-number";
import { bucketFromStart } from "@/lib/booking/slot-allocation";
import { dayWindow, dayCapacity, submitStatus, SLOT_HOLDING_STATUSES } from "@/lib/booking/slot-capacity";
import { classifyJobType } from "@/lib/booking/classification";
import { checkLeadTime, isBlockedByPendingEvaluation } from "@/lib/booking/rules";
import { sendEmail } from "@/lib/email/client";
import { adminNewBookingEmail } from "@/lib/email/templates";
import { buildRrule, expandRecurringDates } from "@/lib/booking/recurrence";
import { writeBookingAttachment } from "@/lib/storage";
import { type ActionResult, bookingDetailInclude } from "@/lib/booking/actions";

// Requester-facing booking submission: lead-time + evaluation-gate + attachment
// validation, capacity/waitlist status, recurrence expansion, then notify the
// approving admins. Split out of actions.ts (which keeps the admin allocate /
// deny / time-change actions) so each file stays focused.
export async function createBookingAction(formData: FormData): Promise<ActionResult | void> {
  const session = await requireUser();
  const userId = session.user.id;
  const te = await getTranslations("errors");

  const parsed = newBookingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? te("invalidInput"), field: first?.path.join(".") };
  }
  const data = parsed.data;

  const lead = checkLeadTime({
    startAt: data.startAt,
    province: data.province,
    urgent: data.isEmergency,
    jobType: data.jobType,
    now: new Date(),
  });
  if (!lead.ok) {
    return {
      ok: false,
      field: "startAt",
      error:
        data.jobType === "SMUS"
          ? te("leadTimeTooSoonCalendar", { days: lead.minimumDays })
          : te("leadTimeTooSoon", { days: lead.minimumDays }),
    };
  }

  // Optional supporting-document attachment (memo, invitation letter, etc.)
  // alongside the remark/notes. Validated before the transaction so a bad
  // file fails fast without creating a half-finished booking.
  const attachment = formData.get("attachment");
  let attachmentBytes: Buffer | null = null;
  let attachmentExt = "";
  if (attachment instanceof File && attachment.size > 0) {
    if (attachment.size > 10_000_000) {
      return { ok: false, field: "attachment", error: te("attachmentTooLarge") };
    }
    const allowed: Record<string, string> = {
      "application/pdf": "pdf",
      "image/png": "png",
      "image/jpeg": "jpg",
    };
    attachmentExt = allowed[attachment.type] ?? "";
    if (!attachmentExt) {
      return { ok: false, field: "attachment", error: te("attachmentBadFormat") };
    }
    attachmentBytes = Buffer.from(await attachment.arrayBuffer());
  }

  // Out-of-hours justification is no longer collected on the booking form;
  // persist whatever the payload still carries (normally none), else null.
  const outOfHoursReason = data.outOfHoursReason ?? null;

  // Evaluation gate: prior unevaluated COMPLETED trips block new bookings.
  const pendingEvals = await prisma.trip.count({
    where: {
      booking: { requesterId: userId, status: "COMPLETED" },
      evaluation: null,
    },
  });
  if (isBlockedByPendingEvaluation(pendingEvals)) {
    return { ok: false, error: te("pendingEvaluation") };
  }

  // Department is locked to the requester's own profile (edited on /account),
  // not chosen per booking. Resolve it server-side and block if it's unset so
  // a tampered or empty payload can't slip a foreign department through. Also
  // pull name/phone to backfill the profile from the ajarn fields below.
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true, name: true, phone: true },
  });
  if (!me?.departmentId) {
    return { ok: false, error: te("noDepartment"), field: "departmentId" };
  }
  const departmentId = me.departmentId;

  // Backfill the requester's own profile from the ajarn fields when it was
  // missing them — the booking form is often the first place this data gets
  // typed in. Never overwrites existing profile data.
  const profileBackfill: { name?: string; phone?: string } = {};
  if (!me.name && data.ajarnName) profileBackfill.name = data.ajarnName;
  if (!me.phone && data.ajarnPhone) profileBackfill.phone = data.ajarnPhone;

  const created = await prisma.$transaction(async (tx) => {
    if (Object.keys(profileBackfill).length > 0) {
      await tx.user.update({ where: { id: userId }, data: profileBackfill });
    }
    // #1 capacity gate: a day's slots = morning + afternoon per non-duty
    // vehicle, plus one spare for the เวร/duty car. When full, waitlist.
    // Only count DISPATCHABLE cars: active, paired to a driver, and that driver
    // (and their user) active. An unpaired or inactive-driver car can't run a
    // trip, so counting it would over-state capacity and accept bookings that
    // then overflow NO_SLOT at solve time.
    const dispatchable = {
      isActive: true,
      assignedDriver: { is: { isActive: true, user: { is: { isActive: true } } } },
    } as const;
    const [nonDutyVehicles, dutyVehicles] = await Promise.all([
      tx.vehicle.count({ where: { ...dispatchable, isDutyVehicle: false } }),
      tx.vehicle.count({ where: { ...dispatchable, isDutyVehicle: true } }),
    ]);
    const capacity = dayCapacity(nonDutyVehicles, dutyVehicles);
    const slotStatusFor = async (when: Date) => {
      const { start, end } = dayWindow(when);
      const used = await tx.booking.count({
        where: { startAt: { gte: start, lt: end }, status: { in: SLOT_HOLDING_STATUSES } },
      });
      return submitStatus(used, capacity);
    };
    const parentStatus = await slotStatusFor(data.startAt);

    // Everything the parent and its recurrence children share. Per-occurrence
    // values (jobNumber, startAt/endAt, jobType, timeBucket, status) are
    // spread in at each create.
    const sharedData = {
      requesterId: userId,
      departmentId,
      purpose: data.purpose,
      destination: data.destination,
      province: data.province,
      googleMapsUrl: data.googleMapsUrl,
      ajarnName: data.ajarnName,
      ajarnPhone: data.ajarnPhone,
      ajarnEmail: data.ajarnEmail,
      coordinatorName: data.coordinatorName,
      coordinatorPhone: data.coordinatorPhone,
      tripType: data.tripType,
      remark: data.remark,
      outOfProvince: data.outOfProvince,
      travelWithinChula: data.travelWithinChula,
      outOfHoursReason,
      passengerCount: data.passengerCount,
      passengerNotes: data.passengerNotes,
      estimatedDistance: data.estimatedDistance,
      // Bus is always an outsourced rental — flag it even if the requester
      // didn't separately tick "may need an outside vehicle".
      needsOutsourcing: data.needsOutsourcing || data.preferredVehicleType === "BUS_OUTSOURCED",
      isEmergency: data.isEmergency,
      emergencyReason: data.emergencyReason,
      maleCount: data.maleCount,
      femaleCount: data.femaleCount,
      pickupLocation: data.pickupLocation,
      returnTrip: data.returnTrip,
      waitAtDestination: data.waitAtDestination,
      pickupReturnTime: data.pickupReturnTime,
      waitingLocation: data.waitingLocation,
      dropOffDone: data.dropOffDone ?? null,
      preferredVehicleType: data.preferredVehicleType,
      // External charter (SMUS) only — null otherwise.
      externalBusCount: data.jobType === "SMUS" ? data.externalBusCount ?? 0 : null,
      externalVanCount: data.jobType === "SMUS" ? data.externalVanCount ?? 0 : null,
    };

    const jobNumber = await nextJobNumber(tx);
    const parent = await tx.booking.create({
      data: {
        ...sharedData,
        jobNumber,
        startAt: data.startAt,
        endAt: data.endAt,
        jobType:
          data.jobType ??
          (data.travelWithinChula
            ? "WERN"
            : classifyJobType({
                startAt: data.startAt,
                endAt: data.endAt,
                outOfProvince: data.outOfProvince,
              })),
        timeBucket: bucketFromStart(data.startAt),
        status: parentStatus,
      },
    });
    await logTransition({
      bookingId: parent.id,
      actorUserId: userId,
      fromStatus: null,
      toStatus: parentStatus,
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
        const childStatus = await slotStatusFor(childStart);
        const child = await tx.booking.create({
          data: {
            ...sharedData,
            jobNumber: childJob,
            startAt: childStart,
            endAt: childEnd,
            jobType:
              data.jobType ??
              (data.travelWithinChula
                ? "WERN"
                : classifyJobType({
                    startAt: childStart,
                    endAt: childEnd,
                    outOfProvince: data.outOfProvince,
                  })),
            timeBucket: bucketFromStart(childStart),
            status: childStatus,
            recurrenceParentId: parent.id,
          },
        });
        await logTransition({
          bookingId: child.id,
          actorUserId: userId,
          fromStatus: null,
          toStatus: childStatus,
          action: "BOOKING_SUBMITTED",
          metadata: { recurrenceParentId: parent.id, occurrence: seq },
          tx,
        });
        seq += 1;
      }
    }

    return parent;
  });

  // Keyed by the now-known booking id, so this happens after the transaction
  // (disk writes don't belong inside a DB transaction).
  if (attachmentBytes) {
    const ref = await writeBookingAttachment(created.id, attachmentExt, attachmentBytes);
    await prisma.booking.update({
      where: { id: created.id },
      data: { attachmentUrl: ref, attachmentFilename: (attachment as File).name },
    });
  }

  const detailed = await prisma.booking.findUniqueOrThrow({
    where: { id: created.id },
    include: bookingDetailInclude,
  });

  // Notify the admins who handle approvals (+ any delegates).
  const approverUsers = await prisma.user.findMany({
    where: { roles: { some: { role: "ADMIN" } }, isActive: true },
    select: { email: true, delegatedTo: { select: { email: true } } },
  });
  const approverEmails = [
    ...approverUsers.map((u) => u.email),
    ...approverUsers.map((u) => u.delegatedTo?.email),
  ].filter((e): e is string => !!e);
  if (approverEmails.length > 0) {
    await sendEmail({ to: approverEmails, ...adminNewBookingEmail(detailed) });
  }

  revalidatePath("/requester");
  revalidatePath("/admin");
  redirect(`/requester/${created.id}`);
}
