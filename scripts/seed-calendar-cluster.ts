// One-off: inject 3 bookings on a single day so the calendar density tint
// and the same-vehicle conflict marker have something to render.
// Run with `npx tsx scripts/seed-calendar-cluster.ts`.
import { PrismaClient } from "@prisma/client";
import { addDays, setHours, setMinutes, startOfDay } from "date-fns";

const prisma = new PrismaClient();

async function main() {
  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: "seed-user-requester" },
    select: { id: true, departmentId: true },
  });
  if (!requester.departmentId) {
    throw new Error("seed-user-requester has no departmentId — re-run db:seed first.");
  }

  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    orderBy: { registrationNumber: "asc" },
    take: 2,
  });
  if (vehicles.length < 2) {
    throw new Error("Need at least 2 active vehicles in the DB.");
  }
  const [vA, vB] = vehicles;

  // Pick "today + 7 days" so the chunk lands inside the current month grid.
  const baseDay = startOfDay(addDays(new Date(), 7));
  const at = (h: number, m: number) => setMinutes(setHours(baseDay, h), m);

  const slots: Array<{ startAt: Date; endAt: Date; vehicleId: string; purpose: string; status: "PENDING_APPROVAL" | "APPROVED" | "ASSIGNED"; destination: string }> = [
    // Two assigned trips on vehicle A, 09:00-11:00 and 11:30-13:30
    // gap = 30 minutes < VEHICLE_BUFFER_MINUTES(60) -> conflict marker fires.
    { startAt: at(9, 0), endAt: at(11, 0), vehicleId: vA!.id, purpose: "Cluster-seed: morning lab visit", destination: "Lab A", status: "ASSIGNED" },
    { startAt: at(11, 30), endAt: at(13, 30), vehicleId: vA!.id, purpose: "Cluster-seed: midday meeting", destination: "Lab B", status: "ASSIGNED" },
    // A separate trip on vehicle B in the afternoon -> no conflict, just adds to density.
    { startAt: at(14, 0), endAt: at(16, 0), vehicleId: vB!.id, purpose: "Cluster-seed: afternoon errand", destination: "Library", status: "APPROVED" },
  ];

  const existing = await prisma.booking.findMany({
    where: { purpose: { startsWith: "Cluster-seed:" } },
    select: { id: true },
  });
  if (existing.length > 0) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: existing.map((e) => e.id) } } });
    await prisma.booking.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } });
    console.log(`cleared ${existing.length} previous cluster-seed rows`);
  }

  // Job numbers are unique. Find the next sequence in the current YYYYMM bucket.
  const ym = `VB-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const peers = await prisma.booking.findMany({
    where: { jobNumber: { startsWith: ym } },
    select: { jobNumber: true },
  });
  let next =
    peers
      .map((p) => Number(p.jobNumber.split("-").pop() ?? 0))
      .reduce((max, n) => (n > max ? n : max), 0) + 1;

  for (const slot of slots) {
    const jobNumber = `${ym}-${next++}`;
    const booking = await prisma.booking.create({
      data: {
        jobNumber,
        requesterId: requester.id,
        departmentId: requester.departmentId,
        purpose: slot.purpose,
        destination: slot.destination,
        province: "กรุงเทพมหานคร",
        startAt: slot.startAt,
        endAt: slot.endAt,
        passengerCount: 2,
        vehicleId: slot.status === "PENDING_APPROVAL" ? null : slot.vehicleId,
        status: slot.status,
        decidedAt: slot.status === "PENDING_APPROVAL" ? null : new Date(),
        jobType: "OT",
        timeBucket: "MORNING_08_12",
      },
    });
    console.log(`created ${booking.jobNumber} ${slot.purpose} @ ${slot.startAt.toISOString()} -> ${slot.endAt.toISOString()} (${slot.status})`);
  }

  console.log(`\nopen /admin/calendar — look at ${baseDay.toDateString()}`);
}

main().finally(() => prisma.$disconnect());
