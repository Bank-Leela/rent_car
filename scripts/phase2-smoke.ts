// Drives the full requester → approver → admin flow against the running server's DB.
// Uses Prisma directly (server actions need a real React form post).
import { PrismaClient } from "@prisma/client";
import { addDays } from "date-fns";
import { generateBookingPdf } from "../lib/pdf/generate";

const prisma = new PrismaClient();

async function main() {
  // Reset just the booking-related rows to keep this idempotent.
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.approval.deleteMany(),
    prisma.cancellation.deleteMany(),
    prisma.evaluation.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.recurrenceRule.deleteMany(),
    prisma.booking.deleteMany(),
  ]);

  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: "seed-user-requester" },
    select: { id: true, departmentId: true },
  });

  const startAt = addDays(new Date(), 10);
  const endAt = new Date(startAt);
  endAt.setHours(startAt.getHours() + 6);

  // Step 1: requester submits → PENDING_APPROVAL
  const booking = await prisma.$transaction(async (tx) => {
    const yyyy = startAt.getUTCFullYear();
    const mm = String(startAt.getUTCMonth() + 1).padStart(2, "0");
    const b = await tx.booking.create({
      data: {
        jobNumber: `VB-${yyyy}${mm}-0001`,
        requesterId: requester.id,
        departmentId: requester.departmentId!,
        purpose: "Phase 2 smoke booking",
        destination: "Hua Hin retreat",
        province: "ประจวบคีรีขันธ์",
        startAt,
        endAt,
        passengerCount: 8,
        estimatedDistance: 250,
        status: "PENDING_APPROVAL",
        jobType: "TJW",
        timeBucket: "MORNING_08_12",
      },
    });
    await tx.auditLog.create({
      data: {
        bookingId: b.id,
        actorUserId: requester.id,
        toStatus: "PENDING_APPROVAL",
        action: "BOOKING_SUBMITTED",
      },
    });
    return b;
  });
  console.log("step 1: submitted →", booking.status, booking.jobNumber);

  // Step 2: approver approves → APPROVED + Approval row + PDF
  await prisma.$transaction(async (tx) => {
    await tx.approval.create({
      data: {
        bookingId: booking.id,
        approverId: "seed-user-approver",
        status: "APPROVED",
        decidedAt: new Date(),
      },
    });
    await tx.booking.update({
      where: { id: booking.id },
      data: { status: "APPROVED", decidedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        bookingId: booking.id,
        actorUserId: "seed-user-approver",
        fromStatus: "PENDING_APPROVAL",
        toStatus: "APPROVED",
        action: "BOOKING_APPROVED",
      },
    });
  });
  const pdfRef = await generateBookingPdf(booking.id);
  await prisma.booking.update({ where: { id: booking.id }, data: { pdfUrl: pdfRef } });
  console.log("step 2: approved → APPROVED, pdf:", pdfRef);

  // Step 3: admin assigns → ASSIGNED
  const vehicle = await prisma.vehicle.findFirstOrThrow({ where: { isActive: true } });
  const driver = await prisma.driver.findFirstOrThrow({ where: { isActive: true } });
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        vehicleId: vehicle.id,
        primaryDriverId: driver.id,
        status: "ASSIGNED",
        decidedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        bookingId: booking.id,
        actorUserId: "seed-user-admin",
        fromStatus: "APPROVED",
        toStatus: "ASSIGNED",
        action: "BOOKING_ASSIGNED",
        metadata: { vehicleId: vehicle.id, primaryDriverId: driver.id },
      },
    });
  });
  console.log("step 3: assigned → ASSIGNED, vehicle:", vehicle.registrationNumber);

  console.log("\nbookingId:", booking.id);
}

main().finally(() => prisma.$disconnect());
