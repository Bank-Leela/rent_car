// Car = driver migration: for APPROVED/ASSIGNED bookings from today forward
// that have a vehicle, set primaryDriverId = that vehicle's assignedDriver.
// Historical/completed bookings are left untouched. Idempotent.
// Run: npx tsx scripts/backfill-booking-drivers.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: ["APPROVED", "ASSIGNED"] },
      startAt: { gte: today },
      vehicleId: { not: null },
    },
    select: {
      id: true,
      vehicleId: true,
      primaryDriverId: true,
      vehicle: { select: { assignedDriverId: true } },
    },
  });

  let changed = 0;
  for (const b of bookings) {
    const want = b.vehicle?.assignedDriverId ?? null;
    if (want && want !== b.primaryDriverId) {
      await prisma.booking.update({ where: { id: b.id }, data: { primaryDriverId: want } });
      changed++;
    }
  }
  console.log(`re-pointed ${changed}/${bookings.length} booking(s) to their car's driver`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
