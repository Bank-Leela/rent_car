import { PrismaClient } from "@prisma/client";
import { addDays } from "date-fns";

const prisma = new PrismaClient();

async function main() {
  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: "seed-user-requester" },
    select: { id: true, departmentId: true },
  });
  const startAt = addDays(new Date(), 10);
  const endAt = addDays(new Date(), 10);
  endAt.setHours(startAt.getHours() + 6);

  const created = await prisma.$transaction(async (tx) => {
    const monthStart = new Date(Date.UTC(startAt.getUTCFullYear(), startAt.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(startAt.getUTCFullYear(), startAt.getUTCMonth() + 1, 1));
    const count = await tx.booking.count({
      where: { createdAt: { gte: monthStart, lt: monthEnd } },
    });
    const yyyy = startAt.getUTCFullYear();
    const mm = String(startAt.getUTCMonth() + 1).padStart(2, "0");
    const seq = String(count + 1).padStart(4, "0");
    const jobNumber = `VB-${yyyy}${mm}-${seq}`;

    const b = await tx.booking.create({
      data: {
        jobNumber,
        requesterId: requester.id,
        departmentId: requester.departmentId!,
        purpose: "Smoke test booking — Phase 1",
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

  console.log(JSON.stringify({ id: created.id, jobNumber: created.jobNumber }));
}

main().finally(() => prisma.$disconnect());
