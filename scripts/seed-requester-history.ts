/**
 * Dev-only: inject terminal-status bookings for the seed requester so the
 * /requester/history page has data to render. Idempotent — wipes prior
 * HIST- rows before reinserting. Run: npx tsx scripts/seed-requester-history.ts
 */
import { PrismaClient, BookingStatus, JobType, TimeBucket } from "@prisma/client";

const prisma = new PrismaClient();

const REQUESTER_ID = "seed-user-requester";
const DEPARTMENT_ID = "seed-dept-medicine";

const daysAgo = (n: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const plusHours = (d: Date, h: number) => new Date(d.getTime() + h * 3600_000);

type Row = {
  n: string;
  status: BookingStatus;
  purpose: string;
  destination: string;
  province: string;
  start: Date;
  jobType: JobType;
  timeBucket: TimeBucket;
  passengerCount: number;
  outOfProvince?: boolean;
  denialReason?: string;
};

const rows: Row[] = [
  {
    n: "HIST-0001",
    status: BookingStatus.COMPLETED,
    purpose: "ประชุมวิชาการคณะแพทยศาสตร์",
    destination: "ศูนย์ประชุมแห่งชาติสิริกิติ์",
    province: "กรุงเทพมหานคร",
    start: daysAgo(30, 9),
    jobType: JobType.OT,
    timeBucket: TimeBucket.MORNING_08_12,
    passengerCount: 4,
  },
  {
    n: "HIST-0002",
    status: BookingStatus.COMPLETED,
    purpose: "ออกหน่วยแพทย์เคลื่อนที่",
    destination: "โรงพยาบาลส่งเสริมสุขภาพตำบลบ้านฉาง",
    province: "ระยอง",
    start: daysAgo(21, 13),
    jobType: JobType.TJW,
    timeBucket: TimeBucket.AFTERNOON_12_16,
    passengerCount: 6,
    outOfProvince: true,
  },
  {
    n: "HIST-0003",
    status: BookingStatus.CANCELLED,
    purpose: "สัมมนาภาควิชา",
    destination: "โรงแรมแชงกรี-ลา เชียงใหม่",
    province: "เชียงใหม่",
    start: daysAgo(16, 8),
    jobType: JobType.NORMAL,
    timeBucket: TimeBucket.MORNING_08_12,
    passengerCount: 8,
    outOfProvince: true,
  },
  {
    n: "HIST-0004",
    status: BookingStatus.DENIED,
    purpose: "ตรวจเยี่ยมหน่วยงานภายนอก",
    destination: "สำนักงานสาธารณสุขจังหวัดภูเก็ต",
    province: "ภูเก็ต",
    start: daysAgo(11, 17),
    jobType: JobType.OT,
    timeBucket: TimeBucket.AFTER_16,
    passengerCount: 3,
    outOfProvince: true,
    denialReason: "รถไม่ว่างในช่วงเวลาดังกล่าว และไม่มีคนขับรองรับ",
  },
  {
    n: "HIST-0005",
    status: BookingStatus.COMPLETED,
    purpose: "เวิร์กช็อปอบรมบุคลากร",
    destination: "มหาวิทยาลัยมหิดล ศาลายา",
    province: "นครปฐม",
    start: daysAgo(5, 9),
    jobType: JobType.SMUS,
    timeBucket: TimeBucket.MORNING_08_12,
    passengerCount: 5,
  },
];

async function main() {
  const deleted = await prisma.booking.deleteMany({
    where: { requesterId: REQUESTER_ID, jobNumber: { startsWith: "HIST-" } },
  });

  for (const r of rows) {
    const start = r.start;
    const end = plusHours(start, 4);
    await prisma.booking.create({
      data: {
        jobNumber: r.n,
        requesterId: REQUESTER_ID,
        departmentId: DEPARTMENT_ID,
        purpose: r.purpose,
        destination: r.destination,
        province: r.province,
        startAt: start,
        endAt: end,
        passengerCount: r.passengerCount,
        jobType: r.jobType,
        timeBucket: r.timeBucket,
        status: r.status,
        outOfProvince: r.outOfProvince ?? false,
        denialReason: r.denialReason ?? null,
        decidedAt: end,
        completedAt: r.status === BookingStatus.COMPLETED ? end : null,
      },
    });
  }

  const total = await prisma.booking.count({
    where: { requesterId: REQUESTER_ID, jobNumber: { startsWith: "HIST-" } },
  });
  console.log(`Wiped ${deleted.count}, inserted ${rows.length}, now ${total} HIST- rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
