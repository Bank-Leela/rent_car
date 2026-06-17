// Seed a realistic day for the CR-07 batch UI demo.
// Picks a target date (default = next Monday >= today), wipes any prior
// "BatchDemo:" rows, then creates:
//   - 1 OnCallShift (so "no duty driver assigned" disappears)
//   - 8 APPROVED bookings covering TJW / OT / WERN / NORMAL, two of them
//     long-haul (>400 km) to exercise the 2-driver rule.
//
// Run: `npx tsx scripts/seed-batch-demo.ts [YYYY-MM-DD]`
import { PrismaClient, type JobType, type TimeBucket } from "@prisma/client";

const prisma = new PrismaClient();

function parseTarget(arg: string | undefined): Date {
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    return new Date(`${arg}T00:00:00`);
  }
  // Default: tomorrow.
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
}

function bucketFor(hour: number): TimeBucket {
  if (hour < 8) return "BEFORE_08";
  if (hour < 12) return "MORNING_08_12";
  if (hour < 16) return "AFTERNOON_12_16";
  return "AFTER_16";
}

async function main() {
  const target = parseTarget(process.argv[2]);
  const dayStart = new Date(target);
  const at = (h: number, m = 0) => {
    const d = new Date(dayStart);
    d.setHours(h, m, 0, 0);
    return d;
  };

  console.log(`Seeding CR-07 batch demo for ${target.toISOString().slice(0, 10)}`);

  // 1. Wipe previous demo rows for any date.
  const prior = await prisma.booking.findMany({
    where: { purpose: { startsWith: "BatchDemo:" } },
    select: { id: true },
  });
  if (prior.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: prior.map((p) => p.id) } } });
    await prisma.booking.deleteMany({ where: { id: { in: prior.map((p) => p.id) } } });
    console.log(`  cleared ${prior.length} prior demo bookings`);
  }

  // 2. Need at least one requester + department + driver.
  const requester = await prisma.user.findFirstOrThrow({
    where: { roles: { some: { role: "REQUESTER" } }, isActive: true, departmentId: { not: null } },
    select: { id: true, departmentId: true },
  });
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
    include: { user: { select: { name: true } } },
  });
  if (drivers.length < 3) {
    throw new Error(`Need >=3 active drivers, have ${drivers.length}. Run npx prisma db seed first.`);
  }
  // Duty rotates by day: day-of-epoch modulo the pool, so consecutive days get
  // consecutive drivers (WERN is supposed to switch every single day).
  const dutyIdx = Math.floor(dayStart.getTime() / 86_400_000) % drivers.length;
  const dutyDriver = drivers[dutyIdx]!;

  // 3. OnCallShift for the day -> rotating duty driver.
  await prisma.onCallShift.upsert({
    where: { date: dayStart },
    create: { date: dayStart, driverId: dutyDriver.id },
    update: { driverId: dutyDriver.id },
  });
  console.log(`  duty driver = ${dutyDriver.user.name}`);

  // 4. Job-number sequence.
  const ym = `VB-${dayStart.getFullYear()}${String(dayStart.getMonth() + 1).padStart(2, "0")}`;
  const peers = await prisma.booking.findMany({
    where: { jobNumber: { startsWith: ym } },
    select: { jobNumber: true },
  });
  let next = peers
    .map((p) => Number(p.jobNumber.split("-").pop() ?? 0))
    .reduce((mx, n) => (n > mx ? n : mx), 0) + 1;

  type Slot = {
    purpose: string;
    destination: string;
    province: string;
    startHour: number;
    endHour: number;
    endDayOffset?: number; // for overnight TJW
    jobType: JobType;
    estimatedDistance?: number;
    outOfProvince: boolean;
  };

  const slots: Slot[] = [
    // TJW (out-of-province + overnight). Long-haul -> 2-driver rule kicks in.
    {
      purpose: "BatchDemo: TJW Chiang Mai medical conference (overnight)",
      destination: "Chiang Mai University Hospital",
      province: "เชียงใหม่",
      startHour: 6,
      endHour: 18,
      endDayOffset: 1,
      jobType: "TJW",
      estimatedDistance: 700,
      outOfProvince: true,
    },
    // TJW shorter same-day-out, overnight return
    {
      purpose: "BatchDemo: TJW Nakhon Pathom outreach (overnight)",
      destination: "Nakhon Pathom field clinic",
      province: "นครปฐม",
      startHour: 7,
      endHour: 17,
      endDayOffset: 1,
      jobType: "TJW",
      estimatedDistance: 110,
      outOfProvince: true,
    },
    // OT (overnight in Bangkok OR start before 08:00 -> classifier picks OT)
    {
      purpose: "BatchDemo: OT early-bird airport run",
      destination: "Suvarnabhumi Airport",
      province: "กรุงเทพมหานคร",
      startHour: 5,
      endHour: 9,
      jobType: "OT",
      estimatedDistance: 60,
      outOfProvince: false,
    },
    // OT after-hours
    {
      purpose: "BatchDemo: OT evening seminar pickup",
      destination: "Chamchuri Square",
      province: "กรุงเทพมหานคร",
      startHour: 17,
      endHour: 21,
      jobType: "OT",
      estimatedDistance: 25,
      outOfProvince: false,
    },
    // WERN (duty driver standing campus rounds)
    {
      purpose: "BatchDemo: WERN duty round — campus shuttle",
      destination: "Faculty of Medicine campus",
      province: "กรุงเทพมหานคร",
      startHour: 8,
      endHour: 12,
      jobType: "WERN",
      estimatedDistance: 15,
      outOfProvince: false,
    },
    // NORMAL morning
    {
      purpose: "BatchDemo: NORMAL morning lab supply",
      destination: "Lab building 3",
      province: "กรุงเทพมหานคร",
      startHour: 9,
      endHour: 11,
      jobType: "NORMAL",
      estimatedDistance: 8,
      outOfProvince: false,
    },
    // NORMAL afternoon
    {
      purpose: "BatchDemo: NORMAL afternoon ajarn ride to King Chulalongkorn Hospital",
      destination: "King Chulalongkorn Memorial Hospital",
      province: "กรุงเทพมหานคร",
      startHour: 13,
      endHour: 15,
      jobType: "NORMAL",
      estimatedDistance: 6,
      outOfProvince: false,
    },
    // NORMAL late-afternoon, slightly tight gap on purpose
    {
      purpose: "BatchDemo: NORMAL document drop to Ministry",
      destination: "Ministry of Public Health",
      province: "นนทบุรี",
      startHour: 14,
      endHour: 16,
      jobType: "NORMAL",
      estimatedDistance: 35,
      outOfProvince: true,
    },
  ];

  for (const s of slots) {
    const startAt = at(s.startHour);
    const endAt = (() => {
      const d = at(s.endHour);
      if (s.endDayOffset) d.setDate(d.getDate() + s.endDayOffset);
      return d;
    })();
    const jobNumber = `${ym}-${next++}`;
    await prisma.booking.create({
      data: {
        jobNumber,
        requesterId: requester.id,
        departmentId: requester.departmentId!,
        purpose: s.purpose,
        destination: s.destination,
        province: s.province,
        startAt,
        endAt,
        passengerCount: 2,
        ajarnName: "อ.สมศักดิ์ ทดสอบ",
        ajarnPhone: "0812345678",
        status: "APPROVED",
        decidedAt: new Date(),
        jobType: s.jobType,
        timeBucket: bucketFor(s.startHour),
        outOfProvince: s.outOfProvince,
        estimatedDistance: s.estimatedDistance ?? null,
      },
    });
    console.log(`  + ${jobNumber} [${s.jobType}] ${s.purpose}`);
  }

  console.log(`\nDone. Open /admin/batch and pick ${target.toISOString().slice(0, 10)} -> Run Batch.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
