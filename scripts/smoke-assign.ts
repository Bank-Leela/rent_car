// Exercises the assign rule path against the test booking.
import { PrismaClient } from "@prisma/client";
import { findBufferConflicts, checkDriverAssignment } from "../lib/booking/rules";

const prisma = new PrismaClient();

async function main() {
  const bookingId = process.argv[2];
  if (!bookingId) throw new Error("usage: tsx scripts/smoke-assign.ts <bookingId>");

  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const vehicle = await prisma.vehicle.findFirstOrThrow({ where: { isActive: true } });
  const driver = await prisma.driver.findFirstOrThrow({ where: { isActive: true } });

  const driverCheck = checkDriverAssignment({
    estimatedDistance: booking.estimatedDistance,
    primaryDriverId: driver.id,
    secondaryDriverId: null,
  });
  console.log("driver rule:", driverCheck);

  const conflicts = findBufferConflicts(
    { startAt: booking.startAt, endAt: booking.endAt },
    [],
  );
  console.log("buffer conflicts:", conflicts.length);

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.booking.update({
      where: { id: bookingId },
      data: {
        vehicleId: vehicle.id,
        primaryDriverId: driver.id,
        status: "ASSIGNED",
        decidedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        bookingId,
        actorUserId: "seed-user-admin",
        fromStatus: "PENDING_APPROVAL",
        toStatus: "ASSIGNED",
        action: "BOOKING_ASSIGNED",
        metadata: { vehicleId: vehicle.id, primaryDriverId: driver.id },
      },
    });
    return u;
  });

  console.log("assigned ->", updated.status, "vehicle:", vehicle.registrationNumber);
}

main().finally(() => prisma.$disconnect());
