// Auto-pair active vehicles <-> active drivers (1:1), writing
// Vehicle.assignedDriverId. Idempotent: only fills cars that have no driver
// yet and drivers not already paired. Run: npx tsx scripts/pair-cars-drivers.ts
import { PrismaClient } from "@prisma/client";
import { pairCarsToDrivers } from "../lib/booking/fleet";

const prisma = new PrismaClient();

async function main() {
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    select: { id: true, assignedDriverId: true },
  });
  const drivers = await prisma.driver.findMany({ where: { isActive: true }, select: { id: true } });

  const takenDrivers = new Set(vehicles.map((v) => v.assignedDriverId).filter(Boolean) as string[]);
  const freeCars = vehicles.filter((v) => !v.assignedDriverId);
  const freeDrivers = drivers.filter((d) => !takenDrivers.has(d.id));

  const pairs = pairCarsToDrivers(freeCars, freeDrivers);
  for (const p of pairs) {
    await prisma.vehicle.update({ where: { id: p.vehicleId }, data: { assignedDriverId: p.driverId } });
  }
  console.log(`paired ${pairs.length} car(s); ${freeCars.length - pairs.length} car(s) still unpaired`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
