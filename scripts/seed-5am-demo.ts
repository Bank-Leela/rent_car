// Seed ONE 05:00 booking for TODAY so the schedule board's auto-fit axis
// visibly stretches below 06:00. Idempotent: wipes prior "FiveAmDemo:" rows
// first. Assigned to a car + driver so it renders as a real block (not queue).
//
// Run: `npx tsx scripts/seed-5am-demo.ts`
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const at = (h: number, m = 0) => {
    const d = new Date(dayStart);
    d.setHours(h, m, 0, 0);
    return d;
  };

  // Wipe any prior 5am demo rows (and their audit logs).
  const prior = await prisma.booking.findMany({
    where: { purpose: { startsWith: "FiveAmDemo:" } },
    select: { id: true },
  });
  if (prior.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: prior.map((p) => p.id) } } });
    await prisma.booking.deleteMany({ where: { id: { in: prior.map((p) => p.id) } } });
    console.log(`  cleared ${prior.length} prior 5am demo booking(s)`);
  }

  const requester = await prisma.user.findFirstOrThrow({
    where: { roles: { some: { role: "REQUESTER" } }, isActive: true, departmentId: { not: null } },
    select: { id: true, departmentId: true },
  });
  const vehicle = await prisma.vehicle.findFirstOrThrow({
    where: { isActive: true, isDutyVehicle: false },
    select: { id: true, registrationNumber: true },
  });
  const driver = await prisma.driver.findFirstOrThrow({
    where: { isActive: true },
    include: { user: { select: { name: true } } },
  });

  // Unique job number: VB-YYYYMM-<next>.
  const ym = `VB-${dayStart.getFullYear()}${String(dayStart.getMonth() + 1).padStart(2, "0")}`;
  const peers = await prisma.booking.findMany({
    where: { jobNumber: { startsWith: ym } },
    select: { jobNumber: true },
  });
  const next = peers.map((p) => Number(p.jobNumber.split("-").pop() ?? 0)).reduce((mx, n) => (n > mx ? n : mx), 0) + 1;

  const booking = await prisma.booking.create({
    data: {
      jobNumber: `${ym}-${next}`,
      requesterId: requester.id,
      departmentId: requester.departmentId!,
      purpose: "FiveAmDemo: OT 05:00 early airport run",
      destination: "Suvarnabhumi Airport",
      province: "กรุงเทพมหานคร",
      startAt: at(5),
      endAt: at(7),
      passengerCount: 2,
      ajarnName: "อ.สมศักดิ์ ทดสอบ",
      ajarnPhone: "0812345678",
      status: "ASSIGNED",
      decidedAt: new Date(),
      jobType: "OT",
      timeBucket: "BEFORE_08",
      outOfProvince: false,
      estimatedDistance: 60,
      vehicleId: vehicle.id,
      primaryDriverId: driver.id,
      driverScheduleStatus: "CONFIRMED",
    },
  });

  console.log(`  + ${booking.jobNumber} 05:00–07:00 on ${vehicle.registrationNumber} / ${driver.user.name}`);
  console.log(`\nDone. Open /admin/schedule for ${dayStart.toISOString().slice(0, 10)} — axis now starts at 5:00.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
