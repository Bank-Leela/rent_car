// Fill the daily dispatch board (ตารางจัดรถรายวัน) with a realistic day: 3 rounds
// for every car-paired driver, already dispatched, so the whiteboard-style board
// can be demonstrated with content instead of a column of "ว่าง".
//
// The rounds obey the real scheduling rules so the board never shows a state the
// solver would refuse to produce:
//   - a driver's rounds never overlap, and keep the universal 2-hour gap
//   - one round per driver per time band, so no car is ever double-booked
//     (the DB also enforces this with a GiST exclusion constraint)
//
// Run: `npx tsx scripts/seed-rounds-demo.ts [YYYY-MM-DD]`   (default: tomorrow)
import { PrismaClient, type JobType, type TimeBucket } from "@prisma/client";

const prisma = new PrismaClient();
const TAG = "RoundsDemo:";

function parseTarget(arg: string | undefined): Date {
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return new Date(`${arg}T00:00:00`);
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

// Three bands with a 2h gap between each — the same shape a real day takes:
// an early run, a midday job, an afternoon one.
const BANDS: Array<{ start: number; end: number; jobType: JobType }> = [
  { start: 7, end: 9, jobType: "NORMAL" },
  { start: 11, end: 13, jobType: "NORMAL" },
  { start: 15, end: 17, jobType: "OT" }, // ends after 16:00 → OT, as the classifier would rule
];

const TRIPS = [
  { place: "โรงพยาบาลจุฬาลงกรณ์ สภากาชาดไทย", purpose: "ส่งเอกสารประสานงาน", province: "กรุงเทพมหานคร" },
  { place: "ท่าอากาศยานสุวรรณภูมิ", purpose: "รับคณาจารย์แลกเปลี่ยน", province: "สมุทรปราการ" },
  { place: "ศูนย์การประชุมแห่งชาติสิริกิติ์", purpose: "ประชุมวิชาการ", province: "กรุงเทพมหานคร" },
  { place: "กระทรวงสาธารณสุข นนทบุรี", purpose: "ยื่นเอกสารราชการ", province: "นนทบุรี" },
  { place: "โรงพยาบาลรามาธิบดี", purpose: "ประสานงานความร่วมมือ", province: "กรุงเทพมหานคร" },
  { place: "สำนักงานเขตปทุมวัน", purpose: "ติดต่อราชการ", province: "กรุงเทพมหานคร" },
  { place: "อาคารจามจุรีสแควร์", purpose: "รับ-ส่งวิทยากร", province: "กรุงเทพมหานคร" },
  { place: "โรงแรมเซ็นทาราแกรนด์", purpose: "รับ-ส่งแขกรับเชิญ", province: "กรุงเทพมหานคร" },
  { place: "ศาลายา มหาวิทยาลัยมหิดล", purpose: "ดูงานร่วมสถาบัน", province: "นครปฐม" },
];

async function main() {
  const target = parseTarget(process.argv[2]);
  const dateStr = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
  const at = (h: number) => {
    const d = new Date(target);
    d.setHours(h, 0, 0, 0);
    return d;
  };

  // Re-runnable, and the cars must actually be free: clear this tag's previous rows
  // anywhere, plus any OTHER demo-tagged booking sitting on the target day — those
  // would hold vehicle-occupancy rows and the DB's no-double-book exclusion
  // constraint would (correctly) refuse the insert. Only demo-tagged rows are
  // touched; real bookings are never deleted.
  const dayStart = new Date(target);
  const dayEnd = new Date(target);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const DEMO_TAGS = [TAG, "SeedDemo:", "DemoFull:", "DemoDuty:", "BatchDemo:"];
  const prior = await prisma.booking.findMany({
    where: {
      OR: [
        { purpose: { startsWith: TAG } },
        {
          AND: [
            { startAt: { gte: dayStart, lt: dayEnd } },
            { OR: DEMO_TAGS.map((p) => ({ purpose: { startsWith: p } })) },
          ],
        },
      ],
    },
    select: { id: true },
  });
  if (prior.length) {
    const ids = prior.map((p) => p.id);
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.bookingClaim.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
    console.log(`cleared ${ids.length} previous ${TAG} rows`);
  }

  const requester = await prisma.user.findFirst({
    where: { departmentId: { not: null } },
    select: { id: true, departmentId: true },
  });
  if (!requester?.departmentId) throw new Error("No requester with a department — run `npm run db:seed` first.");

  const cars = await prisma.vehicle.findMany({
    where: { isActive: true, assignedDriverId: { not: null } },
    orderBy: { registrationNumber: "asc" },
    select: { id: true, registrationNumber: true, assignedDriverId: true },
  });
  if (cars.length === 0) throw new Error("No car-paired active drivers — run `npx tsx scripts/pair-cars-drivers.ts`.");

  let n = 0;
  for (const [ci, car] of cars.entries()) {
    for (const [bi, band] of BANDS.entries()) {
      const trip = TRIPS[(ci * BANDS.length + bi) % TRIPS.length]!;
      await prisma.booking.create({
        data: {
          jobNumber: `VB-RD-${dateStr.replace(/-/g, "")}-${String(n + 1).padStart(3, "0")}`,
          requesterId: requester.id,
          departmentId: requester.departmentId,
          purpose: `${TAG} ${trip.purpose}`,
          destination: trip.place,
          province: trip.province,
          passengerCount: 2 + ((ci + bi) % 6),
          jobType: band.jobType,
          timeBucket: bucketFor(band.start),
          status: "ASSIGNED",
          driverScheduleStatus: "CONFIRMED",
          startAt: at(band.start),
          endAt: at(band.end),
          vehicleId: car.id,
          primaryDriverId: car.assignedDriverId,
          decidedAt: new Date(),
        },
      });
      n++;
    }
  }

  console.log(`Seeded ${n} rounds — ${BANDS.length} per driver across ${cars.length} cars on ${dateStr}.`);
  for (const c of cars) console.log(`  ${c.registrationNumber}: ${BANDS.map((b) => `${b.start}:00–${b.end}:00`).join("  ")}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
