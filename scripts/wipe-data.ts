// One-off data wipe (CR: "keep only the driver station"). Deletes all bookings
// (Trip/Approval/Claim/Evaluation/Cancellation/AuditLog cascade) + the demo
// on-call / unavailability state, and removes individual driver LOGINS (clears
// their passwordHash so only the shared station kiosk can sign in). KEEPS the
// Driver records (the scheduler still needs them), the station, admins, the
// requester, departments, and vehicles.
//
//   npx tsx scripts/wipe-data.ts --dry   # show counts, change nothing
//   npx tsx scripts/wipe-data.ts         # execute

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const STATION = (process.env.DRIVER_STATION_EMAILS ?? "driverstation@chula.ac.th")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

async function main() {
  const dry = process.argv.includes("--dry");
  const driverFilter = { driverProfile: { isNot: null }, email: { notIn: STATION } } as const;

  const [bookings, oncall, unavail, driverLogins] = await Promise.all([
    prisma.booking.count(),
    prisma.onCallShift.count(),
    prisma.driverUnavailability.count(),
    prisma.user.count({ where: { ...driverFilter, passwordHash: { not: null } } }),
  ]);
  console.log(`bookings=${bookings} (+cascade) oncall=${oncall} unavailability=${unavail} driverLoginsToClear=${driverLogins}`);

  if (dry) {
    console.log("dry run — nothing changed");
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction([
    prisma.booking.deleteMany({}),
    prisma.onCallShift.deleteMany({}),
    prisma.driverUnavailability.deleteMany({}),
    prisma.user.updateMany({ where: driverFilter, data: { passwordHash: null, mustChangePassword: false } }),
  ]);

  const left = await prisma.booking.count();
  console.log(`wiped. bookings now=${left}; individual driver logins cleared (station keeps its login).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
