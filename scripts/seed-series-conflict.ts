// Seed the "one day of a recurring booking is full" scenario.
//
// A four-week recurring request sits in the approval queue as ONE card. On the
// SECOND occurrence the fleet is already fully committed, so อนุมัติทั้งชุด can
// approve three of the four days and must say which one it could not.
//
// The full day is made full the only way that is not a guess: every one of the
// six cars gets a trip that OVERLAPS the requested window, so the no-overlap
// rule alone rules each of them out — no reliance on the 2 h gap or the NORMAL
// morning+afternoon cap being counted the way I assumed. A second, afternoon
// trip per car takes the count to the twelve cases asked for and exhausts the
// NORMAL cap as well, so the day is full under every rule at once.
//
// Every row it writes has a purpose starting "DEMO-SERIES:" — that prefix is
// the whole cleanup contract.
//
//   npx tsx scripts/seed-series-conflict.ts          # seed
//   npx tsx scripts/seed-series-conflict.ts --clean  # remove, verified
import { PrismaClient, type TimeBucket } from "@prisma/client";
import { dayHasRoomFor } from "../lib/booking/approval-capacity";

const prisma = new PrismaClient();
const TAG = "DEMO-SERIES:";

function bucketFor(hour: number): TimeBucket {
  if (hour < 8) return "BEFORE_08";
  if (hour < 12) return "MORNING_08_12";
  if (hour < 16) return "AFTERNOON_12_16";
  return "AFTER_16";
}

/** Delete every row this script has ever written, and fail loudly if any survive. */
async function clean(): Promise<number> {
  const rows = await prisma.booking.findMany({
    where: { purpose: { startsWith: TAG } },
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);

  // Children first: a child points at the parent, and the parent cannot go while
  // that reference stands.
  await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.approval.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids }, recurrenceParentId: { not: null } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });

  // A previous cleanup pass reported success while rows survived, so this one
  // re-reads instead of trusting the delete count.
  const left = await prisma.booking.count({ where: { purpose: { startsWith: TAG } } });
  if (left > 0) throw new Error(`cleanup failed: ${left} ${TAG} bookings still in the database`);
  return rows.length;
}

async function main() {
  if (process.argv.includes("--clean")) {
    const n = await clean();
    console.log(n > 0 ? `Removed ${n} ${TAG} bookings. Verified none left.` : `Nothing to remove.`);
    return;
  }

  const removed = await clean();
  if (removed) console.log(`Cleared ${removed} rows from a previous run.\n`);

  const requester = await prisma.user.findFirstOrThrow({
    where: { roles: { some: { role: "REQUESTER" } }, isActive: true, departmentId: { not: null } },
    select: { id: true, name: true, email: true, departmentId: true },
  });
  const drivers = await prisma.driver.findMany({
    where: { isActive: true, assignedVehicle: { isNot: null } },
    include: { user: { select: { name: true } }, assignedVehicle: true },
    orderBy: { id: "asc" },
  });
  if (drivers.length < 2) throw new Error(`Need >=2 drivers with a car, have ${drivers.length}.`);

  // Four Tuesdays, starting the first one at least two weeks out so this never
  // collides with whatever is already in the queue.
  const first = new Date();
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() + 14);
  while (first.getDay() !== 2) first.setDate(first.getDate() + 1);

  const dates = [0, 7, 14, 21].map((offset) => {
    const d = new Date(first);
    d.setDate(d.getDate() + offset);
    return d;
  });
  const FULL_INDEX = 1; // the second occurrence is the one that cannot be served
  const fullDay = dates[FULL_INDEX]!;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const at = (day: Date, h: number) => {
    const d = new Date(day);
    d.setHours(h, 0, 0, 0);
    return d;
  };

  // ── 1. Fill the conflict day ────────────────────────────────────────────────
  // Duty driver for the day, so the board is not also complaining about that.
  await prisma.onCallShift.upsert({
    where: { date: fullDay },
    create: { date: fullDay, driverId: drivers[0]!.id },
    update: { driverId: drivers[0]!.id },
  });

  const blockers: { start: number; end: number; label: string }[] = [
    { start: 8, end: 12, label: "เช้า" },   // overlaps the requested 08:00–12:00 exactly
    { start: 13, end: 16, label: "บ่าย" },  // uses up the NORMAL afternoon slot too
  ];

  let made = 0;
  for (const slot of blockers) {
    for (const d of drivers) {
      await prisma.booking.create({
        data: {
          requesterId: requester.id,
          departmentId: requester.departmentId!,
          purpose: `${TAG} งานเต็มวัน ${slot.label} — ${d.assignedVehicle!.registrationNumber}`,
          destination: "โรงพยาบาลจุฬาลงกรณ์",
          province: "กรุงเทพมหานคร",
          startAt: at(fullDay, slot.start),
          endAt: at(fullDay, slot.end),
          passengerCount: 2,
          ajarnName: "อ.ทดสอบ ระบบ",
          ajarnPhone: "0800000000",
          status: "ASSIGNED",
          decidedAt: new Date(),
          jobType: "NORMAL",
          timeBucket: bucketFor(slot.start),
          outOfProvince: false,
          travelWithinChula: false,
          vehicleId: d.assignedVehicle!.id,
          primaryDriverId: d.id,
        },
      });
      made++;
    }
  }
  console.log(`Filled ${iso(fullDay)} with ${made} assigned trips (${drivers.length} cars × ${blockers.length}).`);

  // ── 2. The recurring request, still awaiting approval ───────────────────────
  const base = {
    requesterId: requester.id,
    departmentId: requester.departmentId!,
    purpose: `${TAG} ประชุมวิชาการประจำสัปดาห์`,
    destination: "อาคารภูมิสิริมังคลานุสรณ์",
    province: "กรุงเทพมหานคร",
    passengerCount: 3,
    ajarnName: "อ.ทดสอบ ระบบ",
    ajarnPhone: "0800000000",
    status: "PENDING_APPROVAL" as const,
    jobType: "NORMAL" as const,
    timeBucket: bucketFor(8),
    outOfProvince: false,
    travelWithinChula: false,
  };

  // The parent IS the first occurrence (see lib/booking/series.ts).
  const parent = await prisma.booking.create({
    data: { ...base, startAt: at(dates[0]!, 8), endAt: at(dates[0]!, 12) },
  });
  for (const day of dates.slice(1)) {
    await prisma.booking.create({
      data: { ...base, startAt: at(day, 8), endAt: at(day, 12), recurrenceParentId: parent.id },
    });
  }

  // ── 2b. Two single requests on the SAME full day, differing only in whether
  //        the requester ticked "จัดหารถเช่าจากภายนอกได้" ────────────────────
  //
  // Same day, same hours, same job type — so the only thing that can explain a
  // different outcome at approval is that one flag. The one who accepted an
  // outside rental should approve straight through to ส่งรถนอก; the one who did
  // not should be refused and offered the board, deny, or the override.
  const singleBase = {
    ...base,
    purpose: "", // set per row
    destination: "ศาลายา",
    passengerCount: 2,
  };
  await prisma.booking.create({
    data: {
      ...singleBase,
      purpose: `${TAG} ขอรถวันเต็ม — ผู้ขอ "รับรถเช่าภายนอกได้"`,
      needsOutsourcing: true,
      startAt: at(fullDay, 9),
      endAt: at(fullDay, 11),
    },
  });
  await prisma.booking.create({
    data: {
      ...singleBase,
      purpose: `${TAG} ขอรถวันเต็ม — ผู้ขอ "ขอรถคณะเท่านั้น"`,
      needsOutsourcing: false,
      startAt: at(fullDay, 9),
      endAt: at(fullDay, 11),
    },
  });

  // ── 3. Ask the real gate, rather than assuming the seeding worked ───────────
  console.log(`\nAsking the approval gate about each occurrence (08:00–12:00 NORMAL):`);
  const occurrences = await prisma.booking.findMany({
    where: { OR: [{ id: parent.id }, { recurrenceParentId: parent.id }] },
    orderBy: { startAt: "asc" },
  });
  let blocked = 0;
  for (const o of occurrences) {
    const verdict = await dayHasRoomFor(o);
    const full = verdict.gated && !verdict.fits;
    if (full) blocked++;
    console.log(`  ${iso(o.startAt)}  ${full ? "FULL — cannot be served" : "has room"}`);
  }

  if (blocked !== 1) {
    throw new Error(
      `Expected exactly 1 blocked day, got ${blocked}. The scenario is not set up as intended — ` +
        `re-run with --clean and check the fleet size.`,
    );
  }

  // The two singles differ only in needsOutsourcing, so report what the gate
  // says about each — the exemption is what makes them behave differently.
  console.log(`\nThe two single requests on ${iso(fullDay)} 09:00–11:00:`);
  const singles = await prisma.booking.findMany({
    where: { purpose: { startsWith: `${TAG} ขอรถวันเต็ม` } },
    orderBy: { needsOutsourcing: "desc" },
  });
  for (const s of singles) {
    const v = await dayHasRoomFor(s);
    const full = v.gated && !v.fits;
    console.log(
      `  needsOutsourcing=${String(s.needsOutsourcing).padEnd(5)} ` +
        `gate=${full ? "FULL" : "has room"}  →  ` +
        (s.needsOutsourcing
          ? "approve goes straight to ส่งรถนอก (OUTSOURCED)"
          : "approve is refused; card offers board / deny / override"),
    );
  }

  console.log(`
RELOAD /admin if it is already open. Re-running this script deletes the previous
rows and creates new ones, so a card left on screen from an earlier run posts an
id that no longer exists — the approve then fails with "ไม่พบการจอง", which is
the queue correctly reporting a booking that is gone, not a bug.

Ready. Open /admin — requester ${requester.name ?? requester.email}. Three things to try:

1. The series card "จองซ้ำ 4 วัน" — press อนุมัติทั้งชุด (4 วัน). Three days go
   through; ${iso(fullDay)} stays in the queue and is named in the warning toast.

2. ขอรถวันเต็ม — ผู้ขอ "รับรถเช่าภายนอกได้" — a normal อนุมัติ button, even though
   the day is full. Pressing it sends the trip to ส่งรถนอก; it leaves the internal
   fleet entirely and never asks for a car.

3. ขอรถวันเต็ม — ผู้ขอ "ขอรถคณะเท่านั้น" — no อนุมัติ. Offers ไปจัดตารางวันนั้น,
   ไม่อนุมัติ, and อนุมัติทั้งที่เต็ม (needs a typed reason). The override keeps the
   trip INTERNAL: it goes to รอเอกสารอนุมัติ with no car, and after
   เอกสารเรียบร้อย it shows on that day's board as approved-and-unplaced.

Remove everything afterwards:
  npx tsx scripts/seed-series-conflict.ts --clean`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
