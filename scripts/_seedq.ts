import { prisma } from "@/lib/db";
(async () => {
  if (process.argv.includes("--down")) {
    const n = await prisma.booking.deleteMany({ where: { purpose: { startsWith: "QUEUE-PAGE-" } } });
    return console.log(`cleaned ${n.count}`);
  }
  const req = await prisma.user.findUniqueOrThrow({ where: { id: "seed-user-requester" }, select: { departmentId: true } });
  for (let i = 1; i <= 8; i++) {
    const s = new Date(`2027-10-${String(i + 4).padStart(2, "0")}T09:00:00`);
    const e = new Date(`2027-10-${String(i + 4).padStart(2, "0")}T11:00:00`);
    await prisma.booking.create({ data: {
      requesterId: "seed-user-requester", departmentId: req.departmentId!,
      purpose: `QUEUE-PAGE-${i}`, destination: `ปลายทาง ${i}`, province: "กรุงเทพมหานคร",
      startAt: s, endAt: e, passengerCount: 1, jobType: "NORMAL", timeBucket: "MORNING_08_12",
      status: "PENDING_APPROVAL",
    }});
  }
  console.log("seeded 8 pending");
})().finally(() => prisma.$disconnect());
