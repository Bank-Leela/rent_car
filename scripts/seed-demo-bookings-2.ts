// Seed 5 additional test bookings (batch 2) for อรวรรณ พิทักษ์ชัย / ภาควิชาอายุรศาสตร์.
// Covers ASSIGNED, COMPLETED, CANCELLED, WAITLIST, OUTSOURCED statuses.
// Tag "SeedDemo2:" — cleared independently from batch 1.
//
// Run: `npx tsx scripts/seed-demo-bookings-2.ts [YYYY-MM-DD]`
import { PrismaClient, type JobType, type TimeBucket } from "@prisma/client";

const prisma = new PrismaClient();

function parseTarget(arg: string | undefined): Date {
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    return new Date(`${arg}T00:00:00`);
  }
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

const TAG = "SeedDemo2:";

async function main() {
  const target = parseTarget(process.argv[2]);
  const dateStr = target.toISOString().slice(0, 10);
  const at = (h: number, m = 0, dayOffset = 0) => {
    const d = new Date(target);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d;
  };

  console.log(`Seeding 5 demo bookings (batch 2) for ${dateStr}`);

  // Wipe prior batch-2 rows.
  const prior = await prisma.booking.findMany({
    where: { purpose: { startsWith: TAG } },
    select: { id: true },
  });
  if (prior.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: prior.map((p) => p.id) } } });
    await prisma.booking.deleteMany({ where: { id: { in: prior.map((p) => p.id) } } });
    console.log(`  cleared ${prior.length} prior batch-2 bookings`);
  }

  // Use อรวรรณ / อายุรศาสตร์ explicitly.
  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: "seed-user-requester" },
    select: { id: true, departmentId: true },
  });

  // Pick two vehicles with known drivers for ASSIGNED / COMPLETED.
  const van = await prisma.vehicle.findFirstOrThrow({
    where: { type: "VAN", isActive: true, assignedDriverId: { not: null } },
    select: { id: true, assignedDriverId: true },
  });
  const pickup = await prisma.vehicle.findFirstOrThrow({
    where: { type: "PICKUP", isActive: true, assignedDriverId: { not: null } },
    select: { id: true, assignedDriverId: true },
  });

  const ym = `VB-${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, "0")}`;
  const peers = await prisma.booking.findMany({
    where: { jobNumber: { startsWith: ym } },
    select: { jobNumber: true },
  });
  let next = peers
    .map((p) => Number(p.jobNumber.split("-").pop() ?? 0))
    .reduce((mx, n) => (n > mx ? n : mx), 0) + 1;

  // ── Case 6: ASSIGNED — TJW ต่างจังหวัด เชียงใหม่ ค้างคืน รถตู้+คนขับ ──
  {
    const jn = `${ym}-${String(next++).padStart(3, "0")}`;
    await prisma.booking.create({
      data: {
        jobNumber: jn,
        requesterId: requester.id,
        departmentId: requester.departmentId!,
        purpose: `${TAG} นำแพทย์นิเทศฝึกอบรมสาขาอายุรศาสตร์ ม.เชียงใหม่`,
        destination: "โรงพยาบาลมหาราชนครเชียงใหม่",
        province: "เชียงใหม่",
        startAt: at(6, 0),
        endAt: at(20, 0, 1),
        passengerCount: 3,
        maleCount: 2,
        femaleCount: 1,
        preferredVehicleType: "VAN",
        returnTrip: true,
        pickupLocation: "หน้าตึกอำนวยการ ชั้น 1",
        waitAtDestination: true,
        needsOutsourcing: false,
        isEmergency: false,
        ajarnName: "รศ.นพ. ธนชาติ มีสุข",
        ajarnPhone: "0811112222",
        ajarnEmail: "tanachat@chula.ac.th",
        coordinatorName: "อรวรรณ พิทักษ์ชัย",
        coordinatorPhone: "0811113333",
        status: "ASSIGNED",
        decidedAt: new Date(),
        jobType: "TJW" as JobType,
        timeBucket: bucketFor(6),
        outOfProvince: true,
        vehicleId: van.id,
        primaryDriverId: van.assignedDriverId,
        needsSecondaryDriver: true,
        driverScheduleStatus: "CONFIRMED",
      },
    });
    console.log(`  ${jn}  [ASSIGNED]  TJW เชียงใหม่ ค้างคืน รถตู้+คนขับ`);
  }

  // ── Case 7: COMPLETED — NORMAL เดินทางเสร็จแล้ว รถกระบะ ──
  {
    const jn = `${ym}-${String(next++).padStart(3, "0")}`;
    const b = await prisma.booking.create({
      data: {
        jobNumber: jn,
        requesterId: requester.id,
        departmentId: requester.departmentId!,
        purpose: `${TAG} ส่งตัวอย่างชีวภาพไปศูนย์วิทยาศาสตร์การแพทย์`,
        destination: "ศูนย์วิทยาศาสตร์การแพทย์ที่ 1 กรุงเทพ",
        province: "กรุงเทพมหานคร",
        startAt: at(8, 30),
        endAt: at(10, 30),
        passengerCount: 2,
        maleCount: 1,
        femaleCount: 1,
        preferredVehicleType: "PICKUP",
        returnTrip: true,
        pickupLocation: "ห้องแล็บ อาคาร 3 ชั้น 2",
        waitAtDestination: false,
        pickupReturnTime: "09:45",
        waitingLocation: "ลานจอดรถหน้าอาคาร A",
        needsOutsourcing: false,
        isEmergency: false,
        ajarnName: "อ.วรรณา ชาติภักดิ์",
        ajarnPhone: "0822223333",
        ajarnEmail: "",
        coordinatorName: "",
        coordinatorPhone: "",
        status: "COMPLETED",
        decidedAt: new Date(target.getTime() - 86_400_000),
        completedAt: at(10, 45),
        jobType: "NORMAL" as JobType,
        timeBucket: bucketFor(8),
        outOfProvince: false,
        vehicleId: pickup.id,
        primaryDriverId: pickup.assignedDriverId,
        driverScheduleStatus: "CONFIRMED",
      },
    });
    // Lazy-create Trip row so evaluation flow works.
    await prisma.trip.create({
      data: { bookingId: b.id, startedAt: at(8, 32), endedAt: at(10, 40), startMileage: 12500, endMileage: 12545 },
    });
    console.log(`  ${jn}  [COMPLETED]  NORMAL ส่งตัวอย่างชีวภาพ รถกระบะ`);
  }

  // ── Case 8: CANCELLED — ยกเลิกก่อน approve ──
  {
    const jn = `${ym}-${String(next++).padStart(3, "0")}`;
    await prisma.booking.create({
      data: {
        jobNumber: jn,
        requesterId: requester.id,
        departmentId: requester.departmentId!,
        purpose: `${TAG} ไปร่วมงานรับรางวัลแพทย์ดีเด่น`,
        destination: "โรงแรมเชอราตัน กรุงเทพ",
        province: "กรุงเทพมหานคร",
        startAt: at(16, 0),
        endAt: at(21, 0),
        passengerCount: 4,
        maleCount: 2,
        femaleCount: 2,
        preferredVehicleType: "VAN",
        returnTrip: true,
        pickupLocation: "ประตูหลักคณะแพทย์",
        waitAtDestination: true,
        needsOutsourcing: false,
        isEmergency: false,
        ajarnName: "ศ.นพ. ประยุทธ์ วงศ์ไพบูลย์",
        ajarnPhone: "0833334444",
        ajarnEmail: "",
        coordinatorName: "",
        coordinatorPhone: "",
        status: "CANCELLED",
        jobType: "OT" as JobType,
        timeBucket: bucketFor(16),
        outOfProvince: false,
        cancellations: {
          create: {
            reason: "การจัดงานถูกเลื่อนออกไป ยกเลิกการเดินทาง",
            cancelledByUser: { connect: { id: requester.id } },
          },
        },
      },
    });
    console.log(`  ${jn}  [CANCELLED]  OT บ่าย ยกเลิกก่อน approve`);
  }

  // ── Case 9: WAITLIST — ล้นคิวช่วงบ่าย ──
  {
    const jn = `${ym}-${String(next++).padStart(3, "0")}`;
    await prisma.booking.create({
      data: {
        jobNumber: jn,
        requesterId: requester.id,
        departmentId: requester.departmentId!,
        purpose: `${TAG} รับแพทย์ที่ปรึกษาจากโรงพยาบาลสมิติเวช`,
        destination: "โรงพยาบาลสมิติเวช สุขุมวิท 49",
        province: "กรุงเทพมหานคร",
        startAt: at(13, 0),
        endAt: at(15, 30),
        passengerCount: 2,
        maleCount: 1,
        femaleCount: 1,
        preferredVehicleType: "SEDAN_DEAN",
        returnTrip: true,
        pickupLocation: "ห้องรับรองชั้น 5",
        waitAtDestination: true,
        needsOutsourcing: false,
        isEmergency: false,
        ajarnName: "ศ.พิเศษ นพ. สุเทพ ลิมปิวัฒน์",
        ajarnPhone: "0844445555",
        ajarnEmail: "sutep@chula.ac.th",
        coordinatorName: "",
        coordinatorPhone: "",
        status: "WAITLIST",
        jobType: "NORMAL" as JobType,
        timeBucket: bucketFor(13),
        outOfProvince: false,
      },
    });
    console.log(`  ${jn}  [WAITLIST]  NORMAL บ่าย รถคณบดี ล้นคิว`);
  }

  // ── Case 10: OUTSOURCED — จัดหารถเช่าภายนอกแล้ว ──
  {
    const jn = `${ym}-${String(next++).padStart(3, "0")}`;
    await prisma.booking.create({
      data: {
        jobNumber: jn,
        requesterId: requester.id,
        departmentId: requester.departmentId!,
        purpose: `${TAG} พาคณะผู้เยี่ยมชมจากต่างประเทศเยี่ยมโรงพยาบาลศิริราช`,
        destination: "โรงพยาบาลศิริราช",
        province: "กรุงเทพมหานคร",
        startAt: at(10, 0),
        endAt: at(14, 0),
        passengerCount: 10,
        maleCount: 5,
        femaleCount: 5,
        preferredVehicleType: "VAN",
        returnTrip: true,
        pickupLocation: "ล็อบบี้อาคารอำนวยการชั้น 1",
        waitAtDestination: true,
        needsOutsourcing: true,
        isEmergency: false,
        ajarnName: "อ.ดร. พรรณวิภา เจริญสุข",
        ajarnPhone: "0855556666",
        ajarnEmail: "panwipa@chula.ac.th",
        coordinatorName: "งานวิรัชกิจ",
        coordinatorPhone: "0855557777",
        status: "OUTSOURCED",
        decidedAt: new Date(),
        jobType: "NORMAL" as JobType,
        timeBucket: bucketFor(10),
        outOfProvince: false,
        outsourceVendor: "บริษัท ชัยประเสริฐทัวร์ จำกัด",
        outsourceCost: 3500,
        outsourceReference: "TRF-2607-088",
        escalatedToKhunTop: true,
      },
    });
    console.log(`  ${jn}  [OUTSOURCED]  NORMAL รับแขกต่างชาติ จัดรถเช่าภายนอก`);
  }

  console.log(`\nDone. 5 bookings added (batch 2) on ${dateStr}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
