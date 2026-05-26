// Drives through phases 3-5 with Prisma + the new server-side helpers.
import { PrismaClient } from "@prisma/client";
import { addDays } from "date-fns";
import { generateBookingPdf } from "../lib/pdf/generate";
import { expandRecurringDates } from "../lib/booking/recurrence";

const prisma = new PrismaClient();

async function reset() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.approval.deleteMany(),
    prisma.cancellation.deleteMany(),
    prisma.evaluation.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.recurrenceRule.deleteMany(),
    prisma.booking.deleteMany(),
  ]);
}

async function main() {
  await reset();

  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: "seed-user-requester" },
    select: { id: true, departmentId: true },
  });
  const dept = requester.departmentId!;
  const startAt = addDays(new Date(), 10);
  const endAt = new Date(startAt);
  endAt.setHours(startAt.getHours() + 6);

  // 1. Recurring booking: parent + 2 children (Mondays + Thursdays for ~14 days from a Mon)
  const recDates = expandRecurringDates({
    startDate: startAt,
    endDate: addDays(startAt, 14),
    weekdays: [startAt.getDay(), (startAt.getDay() + 3) % 7],
  });
  console.log("recurrence dates:", recDates.length);

  // Create parent booking + a few children
  const parent = await prisma.booking.create({
    data: {
      jobNumber: "VB-202605-1001",
      requesterId: requester.id,
      departmentId: dept,
      purpose: "Weekly recurring smoke",
      destination: "Lab building",
      province: "กรุงเทพมหานคร",
      startAt,
      endAt,
      passengerCount: 4,
      estimatedDistance: 50,
      status: "PENDING_APPROVAL",
      jobType: "OT",
      timeBucket: "MORNING_08_12",
    },
  });
  for (let i = 1; i < Math.min(recDates.length, 3); i++) {
    const cs = new Date(recDates[i]);
    cs.setHours(startAt.getHours());
    const ce = new Date(cs); ce.setHours(cs.getHours() + 6);
    await prisma.booking.create({
      data: {
        jobNumber: `VB-202605-100${i + 1}`,
        requesterId: requester.id,
        departmentId: dept,
        purpose: "Weekly recurring smoke",
        destination: "Lab building",
        province: "กรุงเทพมหานคร",
        startAt: cs,
        endAt: ce,
        passengerCount: 4,
        estimatedDistance: 50,
        status: "PENDING_APPROVAL",
        jobType: "OT",
        timeBucket: "MORNING_08_12",
        recurrenceParentId: parent.id,
      },
    });
  }
  await prisma.recurrenceRule.create({
    data: { parentBookingId: parent.id, rrule: "RRULE:FREQ=WEEKLY", startDate: startAt, endDate: addDays(startAt, 14) },
  });
  const children = await prisma.booking.count({ where: { recurrenceParentId: parent.id } });
  console.log("step 1: recurring parent +", children, "children created");

  // 2. Cycle one booking through to COMPLETED so dashboard + evaluation paths work.
  const ride = await prisma.booking.findFirstOrThrow({ where: { recurrenceParentId: parent.id } });

  // Approve
  await prisma.$transaction(async (tx) => {
    await tx.approval.create({
      data: { bookingId: ride.id, approverId: "seed-user-approver", status: "APPROVED", decidedAt: new Date() },
    });
    await tx.booking.update({ where: { id: ride.id }, data: { status: "APPROVED", decidedAt: new Date() } });
    await tx.auditLog.create({
      data: { bookingId: ride.id, actorUserId: "seed-user-approver", fromStatus: "PENDING_APPROVAL", toStatus: "APPROVED", action: "BOOKING_APPROVED" },
    });
  });
  await prisma.booking.update({
    where: { id: ride.id },
    data: { pdfUrl: await generateBookingPdf(ride.id) },
  });
  console.log("step 2: child approved + PDF generated");

  // Assign
  const vehicle = await prisma.vehicle.findFirstOrThrow();
  const driver = await prisma.driver.findFirstOrThrow();
  await prisma.booking.update({
    where: { id: ride.id },
    data: { vehicleId: vehicle.id, primaryDriverId: driver.id, status: "ASSIGNED" },
  });
  console.log("step 3: assigned");

  // Driver completes the trip
  await prisma.$transaction(async (tx) => {
    await tx.trip.create({
      data: { bookingId: ride.id, startMileage: 12000, endMileage: 12080, distanceKm: 80, fuelCost: 320, tollwayCost: 80, usedExpressway: true, startedAt: new Date(), endedAt: new Date() },
    });
    await tx.booking.update({ where: { id: ride.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  });
  console.log("step 4: trip completed");

  // 3. Cancellation on a different child
  const toCancel = await prisma.booking.findFirstOrThrow({
    where: { recurrenceParentId: parent.id, status: "PENDING_APPROVAL" },
  });
  await prisma.$transaction(async (tx) => {
    await tx.cancellation.create({ data: { bookingId: toCancel.id, cancelledByUserId: requester.id, reason: "Plans changed" } });
    await tx.booking.update({ where: { id: toCancel.id }, data: { status: "CANCELLED" } });
  });
  console.log("step 5: cancelled one child");

  // 4. Outsourcing on a different child
  const toOut = await prisma.booking.findFirstOrThrow({
    where: { recurrenceParentId: parent.id, status: "PENDING_APPROVAL" },
  }).catch(() => null);
  if (toOut) {
    await prisma.$transaction(async (tx) => {
      await tx.approval.create({ data: { bookingId: toOut.id, approverId: "seed-user-approver", status: "APPROVED", decidedAt: new Date() } });
      await tx.booking.update({
        where: { id: toOut.id },
        data: { status: "ASSIGNED", outsourceVendor: "BangkokVan Co", outsourceCost: 4500, outsourceReference: "BV-12345", needsOutsourcing: true, decidedAt: new Date() },
      });
    });
    console.log("step 6: outsourced one child");
  }

  // Snapshot
  const summary = await prisma.booking.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("\nfinal status breakdown:");
  for (const s of summary) console.log(" ", s.status, s._count._all);
}

main().finally(() => prisma.$disconnect());
