// Quick verifier: list BatchDemo bookings and which date the batch UI
// would pick them up on (replicating the same Date parsing).
import { PrismaClient } from "@prisma/client";
import { startOfDay } from "date-fns";

const prisma = new PrismaClient();

async function main() {
  const target = process.argv[2] ?? "2026-06-04";
  const date = new Date(`${target}T00:00:00`);
  const dayStart = startOfDay(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  console.log(`Batch window for input "${target}":`);
  console.log(`  ${dayStart.toString()}`);
  console.log(`  .. ${dayEnd.toString()}\n`);

  const rows = await prisma.booking.findMany({
    where: { startAt: { gte: dayStart, lt: dayEnd }, status: "APPROVED" },
    orderBy: { startAt: "asc" },
    select: {
      jobNumber: true,
      jobType: true,
      purpose: true,
      startAt: true,
      endAt: true,
      estimatedDistance: true,
      outOfProvince: true,
    },
  });
  console.log(`Found ${rows.length} APPROVED bookings on that day:`);
  for (const r of rows) {
    const hrs = `${r.startAt.toLocaleString()} -> ${r.endAt.toLocaleString()}`;
    const km = r.estimatedDistance ? ` ${r.estimatedDistance}km` : "";
    console.log(`  ${r.jobNumber} [${r.jobType}]${km} ${hrs}`);
    console.log(`    ${r.purpose}`);
  }

  const duty = await prisma.onCallShift.findUnique({
    where: { date: dayStart },
    include: { driver: { include: { user: { select: { name: true } } } } },
  });
  console.log(`\nOnCallShift: ${duty ? duty.driver.user.name : "NONE"}`);
}

main().finally(() => prisma.$disconnect());
