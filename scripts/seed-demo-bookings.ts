// Seed 5 diverse test bookings for a single day (default: tomorrow).
// Each case covers a distinct status / trip type / jobType combo.
//
// Run: `npx tsx scripts/seed-demo-bookings.ts [YYYY-MM-DD]`
import { PrismaClient, type JobType, type TimeBucket, type BookingStatus } from "@prisma/client";

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

const TAG = "SeedDemo:";

async function main() {
  const target = parseTarget(process.argv[2]);
  const at = (h: number, m = 0) => {
    const d = new Date(target);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const dateStr = target.toISOString().slice(0, 10);
  console.log(`Seeding 5 demo bookings for ${dateStr}`);

  // Wipe prior demo rows for any date.
  const prior = await prisma.booking.findMany({
    where: { purpose: { startsWith: TAG } },
    select: { id: true },
  });
  if (prior.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: prior.map((p) => p.id) } } });
    await prisma.booking.deleteMany({ where: { id: { in: prior.map((p) => p.id) } } });
    console.log(`  cleared ${prior.length} prior demo bookings`);
  }

  const requester = await prisma.user.findFirstOrThrow({
    where: { roles: { some: { role: "REQUESTER" } }, isActive: true, departmentId: { not: null } },
    select: { id: true, departmentId: true },
  });
  const ym = `VB-${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, "0")}`;
  const peers = await prisma.booking.findMany({
    where: { jobNumber: { startsWith: ym } },
    select: { jobNumber: true },
  });
  let next = peers
    .map((p) => Number(p.jobNumber.split("-").pop() ?? 0))
    .reduce((mx, n) => (n > mx ? n : mx), 0) + 1;

  type Case = {
    purpose: string;
    destination: string;
    province: string;
    startHour: number;
    startMin?: number;
    endHour: number;
    endMin?: number;
    endDayOffset?: number;
    jobType: JobType;
    status: BookingStatus;
    outOfProvince: boolean;
    passengerCount: number;
    maleCount?: number;
    femaleCount?: number;
    preferredVehicleType?: "VAN" | "TRUCK_6_WHEEL" | "PICKUP" | "SEDAN_DEAN" | "BUS_OUTSOURCED";
    returnTrip?: boolean;
    pickupLocation?: string;
    waitingLocation?: string;
    waitAtDestination?: boolean;
    pickupReturnTime?: string;
    needsOutsourcing?: boolean;
    isEmergency?: boolean;
    externalBusCount?: number;
    externalVanCount?: number;
    denialReason?: string;
    passengerNotes?: string;
    googleMapsUrl?: string;
    ajarnName?: string;
    ajarnPhone?: string;
  };

  const cases: Case[] = [
    // 1. PENDING_APPROVAL — เดินทางปกติ กรุงเทพ ขอรถตู้ เช้า
    {
      purpose: `${TAG} ประชุมคณะกรรมการวิชาการ สำนักงานใหญ่`,
      destination: "อาคารศูนย์การประชุมแห่งชาติสิริกิติ์",
      province: "กรุงเทพมหานคร",
      startHour: 9,
      endHour: 12,
      jobType: "NORMAL",
      status: "PENDING_APPROVAL",
      outOfProvince: false,
      passengerCount: 5,
      maleCount: 2,
      femaleCount: 3,
      preferredVehicleType: "VAN",
      pickupLocation: "หน้าตึกอำนวยการ ชั้น 1",
      waitAtDestination: true,
      ajarnName: "ศ.ดร. สมชาย ทดสอบ",
      ajarnPhone: "0812345671",
      passengerNotes: "มีผู้สูงอายุ 1 ท่าน กรุณาจัดที่นั่งหน้า",
    },
    // 2. APPROVED — OT เช้ามืด รับที่สนามบิน ขอรถกระบะ
    {
      purpose: `${TAG} รับคณาจารย์แลกเปลี่ยนจากสนามบินสุวรรณภูมิ`,
      destination: "ท่าอากาศยานสุวรรณภูมิ",
      province: "กรุงเทพมหานคร",
      startHour: 5,
      startMin: 30,
      endHour: 8,
      jobType: "OT",
      status: "APPROVED",
      outOfProvince: false,
      passengerCount: 2,
      maleCount: 1,
      femaleCount: 1,
      preferredVehicleType: "VAN",
      pickupLocation: "ประตู 2 คณะแพทย์",
      waitAtDestination: false,
      pickupReturnTime: "06:30",
      waitingLocation: "ลานจอดรถ Terminal 1",
      googleMapsUrl: "https://maps.google.com/?q=Suvarnabhumi+Airport",
      ajarnName: "ผศ.ดร. วิไล รักษ์ชาติ",
      ajarnPhone: "0823456782",
    },
    // 3. PENDING_APPROVAL — เที่ยวเดียว (returnTrip=false) ไปส่งโรงพยาบาล
    {
      purpose: `${TAG} ส่งเอกสารประสานงานที่โรงพยาบาลจุฬาลงกรณ์`,
      destination: "โรงพยาบาลจุฬาลงกรณ์ สภากาชาดไทย",
      province: "กรุงเทพมหานคร",
      startHour: 10,
      endHour: 13,
      jobType: "NORMAL",
      status: "PENDING_APPROVAL",
      outOfProvince: false,
      passengerCount: 1,
      maleCount: 1,
      femaleCount: 0,
      preferredVehicleType: "PICKUP",
      returnTrip: false,
      pickupLocation: "หน้าภาควิชาอายุรศาสตร์",
      ajarnName: "อ.ประภา ศรีสุข",
      ajarnPhone: "0834567893",
      passengerNotes: "ไม่เดินทางกลับ — admin กรุณาใส่เวลาสิ้นสุดก่อน approve",
    },
    // 4. PENDING_APPROVAL — SMUS หลักสูตรนิสิตแพทย์ รถบัส+ตู้ภายนอก ต่างจังหวัด
    {
      purpose: `${TAG} พานิสิตแพทย์ฝึกภาคสนาม จ.ชลบุรี (SMUS)`,
      destination: "โรงพยาบาลชลบุรี",
      province: "ชลบุรี",
      startHour: 7,
      endHour: 18,
      jobType: "SMUS",
      status: "PENDING_APPROVAL",
      outOfProvince: true,
      passengerCount: 45,
      maleCount: 20,
      femaleCount: 25,
      preferredVehicleType: "BUS_OUTSOURCED",
      externalBusCount: 1,
      externalVanCount: 2,
      pickupLocation: "ลานจอดรถคณะแพทยศาสตร์",
      ajarnName: "รศ.ดร. ณัฐวุฒิ บุญสม",
      ajarnPhone: "0845678904",
      passengerNotes: "กรุณาจัดรถบัสปรับอากาศ พร้อมตู้เสบียง 2 คัน",
    },
    // 5. DENIED — ขอรถบัสเช่าภายนอก บ่าย — ถูกปฏิเสธเพราะรถไม่ว่าง
    {
      purpose: `${TAG} รับ-ส่งแขกรับเชิญงานสัมมนาระดับชาติ`,
      destination: "โรงแรมเซ็นทาราแกรนด์ เซ็นทรัลเวิลด์",
      province: "กรุงเทพมหานคร",
      startHour: 13,
      endHour: 17,
      jobType: "NORMAL",
      status: "DENIED",
      outOfProvince: false,
      passengerCount: 25,
      maleCount: 12,
      femaleCount: 13,
      preferredVehicleType: "BUS_OUTSOURCED",
      needsOutsourcing: true,
      ajarnName: "ศ.นพ. ธีระ วงศ์ศิลป์",
      ajarnPhone: "0856789015",
      denialReason:
        "รถบัสภายนอกที่ขอไม่ว่างในวันดังกล่าว กรุณายื่นคำขอใหม่ล่วงหน้าอย่างน้อย 7 วันทำการ",
    },
  ];

  for (const c of cases) {
    const startAt = at(c.startHour, c.startMin ?? 0);
    const endAt = (() => {
      const d = at(c.endHour, c.endMin ?? 0);
      if (c.endDayOffset) d.setDate(d.getDate() + c.endDayOffset);
      return d;
    })();

    const jobNumber = `${ym}-${String(next++).padStart(3, "0")}`;
    await prisma.booking.create({
      data: {
        jobNumber,
        requesterId: requester.id,
        departmentId: requester.departmentId!,
        purpose: c.purpose,
        destination: c.destination,
        province: c.province,
        startAt,
        endAt,
        passengerCount: c.passengerCount,
        maleCount: c.maleCount ?? null,
        femaleCount: c.femaleCount ?? null,
        preferredVehicleType: c.preferredVehicleType ?? "VAN",
        returnTrip: c.returnTrip ?? true,
        pickupLocation: c.pickupLocation ?? null,
        waitAtDestination: c.waitAtDestination ?? true,
        pickupReturnTime: c.pickupReturnTime ?? null,
        waitingLocation: c.waitingLocation ?? null,
        needsOutsourcing: c.needsOutsourcing ?? false,
        isEmergency: c.isEmergency ?? false,
        externalBusCount: c.externalBusCount ?? null,
        externalVanCount: c.externalVanCount ?? null,
        passengerNotes: c.passengerNotes ?? null,
        googleMapsUrl: c.googleMapsUrl ?? null,
        ajarnName: c.ajarnName ?? "",
        ajarnPhone: c.ajarnPhone ?? "",
        ajarnEmail: "",
        coordinatorName: "",
        coordinatorPhone: "",
        status: c.status,
        denialReason: c.denialReason ?? null,
        decidedAt: ["APPROVED", "DENIED"].includes(c.status) ? new Date() : null,
        jobType: c.jobType,
        timeBucket: bucketFor(c.startHour),
        outOfProvince: c.outOfProvince,
      },
    });
    console.log(`  ${jobNumber}  [${c.status}]  ${c.purpose.replace(TAG, "").trim()}`);
  }

  console.log(`\nDone. ${cases.length} bookings on ${dateStr}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
