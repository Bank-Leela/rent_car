/* Non-destructive: make sure there are 6 active vehicles with one เวร (duty)
 * car, without wiping demo data. Run: npx tsx scripts/ensure-fleet.ts */
import { prisma } from "@/lib/db";
import { VehicleType } from "@prisma/client";

const TARGET = 6;
const TYPES: VehicleType[] = [VehicleType.SEDAN, VehicleType.VAN, VehicleType.PICKUP];

async function main() {
  const active = await prisma.vehicle.count({ where: { isActive: true } });
  for (let i = active; i < TARGET; i++) {
    const registrationNumber = `รถเวร-90${i + 1}`;
    await prisma.vehicle.upsert({
      where: { registrationNumber },
      update: { isActive: true },
      create: { registrationNumber, type: TYPES[i % TYPES.length]!, capacity: 4, isActive: true },
    });
  }
  const all = await prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { registrationNumber: "asc" } });
  if (!all.some((v) => v.isDutyVehicle) && all[0]) {
    await prisma.vehicle.update({ where: { id: all[0].id }, data: { isDutyVehicle: true } });
  }
  const after = await prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { registrationNumber: "asc" } });
  console.log(
    `active vehicles: ${after.length} | duty: ${after.find((v) => v.isDutyVehicle)?.registrationNumber ?? "(none)"}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
