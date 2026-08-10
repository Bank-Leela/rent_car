// Seed a day that HAS free drivers, so a drag-drop on the schedule board lands
// a driver (green block) instead of driverless. Idempotent: wipes prior
// "FreeDayDemo:" rows for the day first.
//
//   duty driver (excluded) + 1 already-assigned car + 2 unassigned queue jobs
//   → 4 drivers stay free → dropping a queue card assigns the fairest one.
//
// Run: `npx tsx scripts/seed-free-driver-day.ts [YYYY-MM-DD]`   (default: today)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseTarget(arg: string | undefined): Date {
  const d = new Date();
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    const [y, m, dd] = arg.split("-").map(Number);
    d.setFullYear(y, m - 1, dd);
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  const dayStart = parseTarget(process.argv[2]);
  const at = (h: number, m = 0) => {
    const d = new Date(dayStart);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const iso = dayStart.toLocaleDateString("en-CA"); // local YYYY-MM-DD

  // 1. Wipe prior demo rows for this day.
  const prior = await prisma.booking.findMany({
    where: { purpose: { startsWith: "FreeDayDemo:" }, startAt: { gte: dayStart, lt: at(24) } },
    select: { id: true },
  });
  if (prior.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: prior.map((p) => p.id) } } });
    await prisma.booking.deleteMany({ where: { id: { in: prior.map((p) => p.id) } } });
    console.log(`  cleared ${prior.length} prior FreeDayDemo booking(s)`);
  }

  const requester = await prisma.user.findFirstOrThrow({
    where: { roles: { some: { role: "REQUESTER" } }, isActive: true, departmentId: { not: null } },
    select: { id: true, departmentId: true },
  });
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
    include: { user: { select: { name: true } } },
  });
  if (drivers.length < 3) throw new Error(`need >=3 active drivers, have ${drivers.length}`);
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    orderBy: { registrationNumber: "asc" },
    select: { id: true, registrationNumber: true },
  });
  if (vehicles.length < 2) throw new Error(`need >=2 active vehicles, have ${vehicles.length}`);

  const dutyDriver = drivers[0]!;
  const busyDriver = drivers[1]!;
  const quarterDriver = drivers[2]!;
  const busyCar = vehicles[0]!;
  const quarterCar = vehicles[1]!;

  // 2. Duty shift for the day.
  await prisma.onCallShift.upsert({
    where: { date: dayStart },
    create: { date: dayStart, driverId: dutyDriver.id },
    update: { driverId: dutyDriver.id },
  });

  const base = {
    requesterId: requester.id,
    departmentId: requester.departmentId!,
    province: "กรุงเทพมหานคร",
    passengerCount: 2,
    ajarnName: "อ.สมศักดิ์ ทดสอบ",
    ajarnPhone: "0812345678",
    jobType: "NORMAL" as const,
    timeBucket: "MORNING_08_12" as const,
    outOfProvince: false,
    estimatedDistance: 10,
  };

  // 3a. One ASSIGNED booking (car + driver) so a car shows occupied — realism.
  await prisma.booking.create({
    data: {
      ...base,
      purpose: "FreeDayDemo: assigned campus run",
      destination: "Faculty of Medicine",
      startAt: at(8),
      endAt: at(10),
      status: "ASSIGNED",
      decidedAt: new Date(),
      vehicleId: busyCar.id,
      primaryDriverId: busyDriver.id,
      driverScheduleStatus: "CONFIRMED",
    },
  });

  // 3a-2. An ASSIGNED block at a NON-round time (08:15–09:45) so you can see the
  //       timeline render minutes precisely (block starts a quarter past 08:00).
  await prisma.booking.create({
    data: {
      ...base,
      purpose: "FreeDayDemo: 08:15 quarter-past pickup",
      destination: "Main gate",
      startAt: at(8, 15),
      endAt: at(9, 45),
      status: "ASSIGNED",
      decidedAt: new Date(),
      vehicleId: quarterCar.id,
      primaryDriverId: quarterDriver.id,
      driverScheduleStatus: "CONFIRMED",
    },
  });

  // 3b. Two UNASSIGNED queue jobs (no car, no driver) — drag these onto an open
  //     car; a free driver will be assigned (green block).
  for (const [h, label] of [[9, "morning lab supply"], [13, "afternoon ajarn ride"]] as const) {
    await prisma.booking.create({
      data: {
        ...base,
        purpose: `FreeDayDemo: queue ${label}`,
        destination: label,
        startAt: at(h),
        endAt: at(h + 2),
        timeBucket: h < 12 ? "MORNING_08_12" : "AFTERNOON_12_16",
        status: "APPROVED",
        decidedAt: new Date(),
      },
    });
  }

  const freeCount = drivers.length - 3; // minus duty + two assigned
  console.log(`\nSeeded FreeDayDemo for ${iso}`);
  console.log(`  duty (excluded): ${dutyDriver.user.name}`);
  console.log(`  assigned: ${busyDriver.user.name} on ${busyCar.registrationNumber} (08:00–10:00)`);
  console.log(`  assigned: ${quarterDriver.user.name} on ${quarterCar.registrationNumber} (08:15–09:45, non-round)`);
  console.log(`  free drivers: ${freeCount}  → queue drops will land GREEN`);
  console.log(`\nOpen /admin/schedule?date=${iso} — drag a queue card onto an open car.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
