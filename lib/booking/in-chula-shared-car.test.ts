import { afterAll, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";

vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (k: string) => k) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { isExclusionViolation } from "@/lib/booking/db-errors";
import { findVehicleConflicts } from "@/lib/booking/vehicle-conflicts";

/**
 * §5c against the real constraints.
 *
 * The rule is enforced in Postgres, not in app code, so a unit test of canChain
 * proves nothing about whether the database actually permits the overlap. These
 * write real Booking rows — the trigger derives the occupancy and the two
 * exclusion constraints judge them.
 */
const MARK = "CHULA-PAIR:";

afterAll(async () => {
  const rows = await prisma.booking.findMany({
    where: { purpose: { startsWith: MARK } }, select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

async function book(opts: {
  label: string; startMin: number; durationMin: number; inChula: boolean; vehicleId: string;
}) {
  const req = await prisma.user.findUniqueOrThrow({
    where: { id: "seed-user-requester" }, select: { departmentId: true },
  });
  // A day far enough out that seeded demo data cannot collide with it.
  const base = startOfDay(addDays(new Date(), 400));
  const start = new Date(base); start.setHours(9, opts.startMin, 0, 0);
  const end = new Date(start.getTime() + opts.durationMin * 60_000);
  return prisma.booking.create({
    data: {
      requesterId: "seed-user-requester", departmentId: req.departmentId!,
      purpose: `${MARK} ${opts.label}`, destination: "จุฬาฯ", province: "กรุงเทพมหานคร",
      startAt: start, endAt: end, passengerCount: 1,
      status: "ASSIGNED", jobType: opts.inChula ? "WERN" : "NORMAL",
      timeBucket: "MORNING_08_12",
      travelWithinChula: opts.inChula,
      vehicleId: opts.vehicleId,
    },
  });
}

describe("§5c — the database permits exactly the intended overlap", () => {
  it("lets two in-Chula errands share one car, and still refuses the rest", async () => {
    const car = await prisma.vehicle.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
    const other = await prisma.vehicle.findFirstOrThrow({
      where: { isActive: true, id: { not: car.id } }, select: { id: true },
    });

    // 1. An in-Chula errand at 09:00.
    await book({ label: "first-chula", startMin: 0, durationMin: 60, inChula: true, vehicleId: car.id });

    // 2. A second in-Chula errand 5 minutes later on the SAME car — the whole point.
    await expect(
      book({ label: "paired-chula", startMin: 5, durationMin: 60, inChula: true, vehicleId: car.id }),
    ).resolves.toBeTruthy();

    // 3. A NORMAL trip overlapping them on that car must still be refused: it may
    //    be leaving the province, and this is the case the second constraint exists for.
    let normalErr: unknown = null;
    try {
      await book({ label: "normal-overlap", startMin: 10, durationMin: 60, inChula: false, vehicleId: car.id });
    } catch (e) { normalErr = e; }
    expect(isExclusionViolation(normalErr), "in-Chula must not shelter a normal trip").toBe(true);

    // 4. Two NORMAL trips overlapping each other are refused exactly as before.
    await book({ label: "normal-a", startMin: 0, durationMin: 60, inChula: false, vehicleId: other.id });
    let pairErr: unknown = null;
    try {
      await book({ label: "normal-b", startMin: 30, durationMin: 60, inChula: false, vehicleId: other.id });
    } catch (e) { pairErr = e; }
    expect(isExclusionViolation(pairErr), "§5 still holds for everything else").toBe(true);
  });

  it("bounds the pairing window in the app, since the constraints cannot", async () => {
    const car = await prisma.vehicle.findFirstOrThrow({
      where: { isActive: true }, select: { id: true },
    });
    // 09:00 for three hours.
    const long = await book({ label: "window-long", startMin: 0, durationMin: 180, inChula: true, vehicleId: car.id });

    // 10:00 — an hour later, so NOT a §5c partner. The database accepts it: two
    // inChula rows match neither exclusion constraint at any distance. This is the
    // hole findVehicleConflicts exists to close.
    const far = { startAt: new Date(long.startAt.getTime() + 60 * 60_000),
                  endAt: new Date(long.startAt.getTime() + 120 * 60_000),
                  travelWithinChula: true };
    expect(
      await findVehicleConflicts(far, car.id),
      "an in-Chula trip an hour away is not a partner and must be refused",
    ).not.toHaveLength(0);

    // 09:05 — inside the window, so genuinely shareable.
    const near = { startAt: new Date(long.startAt.getTime() + 5 * 60_000),
                   endAt: new Date(long.startAt.getTime() + 50 * 60_000),
                   travelWithinChula: true };
    expect(
      await findVehicleConflicts(near, car.id),
      "a real §5c partner must still be allowed",
    ).toHaveLength(0);

    // A NORMAL trip in the same window is refused whatever the neighbour is.
    expect(
      await findVehicleConflicts({ ...near, travelWithinChula: false }, car.id),
    ).not.toHaveLength(0);
  });
});
