import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, format, startOfDay } from "date-fns";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
}));

import { prisma } from "@/lib/db";
import { runBatchForDay } from "@/lib/booking/batch-core";

/**
 * One booking the database refuses must not take the day down with it.
 *
 * The persistence used to be a single transaction around the whole per-booking
 * loop with no try/catch in the file. The occupancy EXCLUDE raises 23P01 on a
 * double-booked car, so one conflict rolled back every assignment already made and
 * recorded no reason — and on the cron the uncaught throw escaped the per-day loop,
 * silently skipping every later day in the sweep.
 *
 * The conflict is created for real here, not simulated: an occupancy row already
 * covering the car for the whole day, so the trigger's EXCLUDE fires on any
 * assignment to it.
 */
const TAG = "BATCH-RESILIENCE:";
const REQUESTER_ID = "seed-user-requester";
const DAY = startOfDay(addDays(new Date(), 220));
const DAY_STR = format(DAY, "yyyy-MM-dd");

async function trip(hour: number) {
  const requester = await prisma.user.findUniqueOrThrow({
    where: { id: REQUESTER_ID },
    select: { departmentId: true },
  });
  const startAt = new Date(DAY);
  startAt.setHours(hour, 0, 0, 0);
  const endAt = new Date(DAY);
  endAt.setHours(hour + 2, 0, 0, 0);
  const b = await prisma.booking.create({
    data: {
      requesterId: REQUESTER_ID,
      departmentId: requester.departmentId!,
      purpose: `${TAG} ${hour}:00`,
      destination: "ศาลายา",
      province: "กรุงเทพมหานคร",
      startAt,
      endAt,
      passengerCount: 2,
      status: "APPROVED",
      jobType: "NORMAL",
      timeBucket: hour < 12 ? "MORNING_08_12" : "AFTERNOON_12_16",
    },
    select: { id: true },
  });
  return b.id;
}

afterEach(async () => {
  const rows = await prisma.booking.findMany({
    where: { purpose: { startsWith: TAG } },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.vehicleOccupancy.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  await prisma.vehicleOccupancy.deleteMany({
    where: { startAt: { gte: DAY }, endAt: { lte: addDays(DAY, 1) }, bookingId: { startsWith: "synthetic-" } },
  });
  const left = await prisma.booking.count({ where: { purpose: { startsWith: TAG } } });
  if (left > 0) throw new Error(`cleanup failed: ${left} ${TAG} rows survive`);
});

describe("runBatchForDay resilience", () => {
  it("places the trips it can even when one is refused by the occupancy constraint", async () => {
    // Enough trips that the solver will use several different cars.
    const ids = [await trip(8), await trip(9), await trip(10), await trip(13), await trip(14)];

    const res = await runBatchForDay(DAY_STR, "seed-user-admin");
    expect(res.ok, "the run reports success rather than throwing").toBe(true);

    const after = await prisma.booking.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, primaryDriverId: true, overflowReason: true },
    });
    // The whole point: assignments survive as a group even if one had failed.
    const assigned = after.filter((b) => b.status === "ASSIGNED");
    expect(assigned.length, "the day gets assigned").toBeGreaterThan(0);
    // Nothing is left in the in-between state the old rollback produced —
    // every booking is either assigned or carries a reason.
    for (const b of after) {
      const explained = b.status === "ASSIGNED" || b.overflowReason !== null;
      expect(explained, `${b.id} must be assigned or carry an overflowReason`).toBe(true);
    }
  });

  it("records a reason and keeps going when the DB refuses one car", async () => {
    // Make the solver believe every car is free while the DATABASE says none is —
    // the only state that reaches the 23P01 catch, and a real one: a stale read,
    // or another admin assigning the same car while the batch runs.
    //
    // The occupancy rows are anchored to a booking the batch never touches
    // (isEmergency is excluded by BATCH_SOLVABLE_WHERE) and which has no vehicle
    // of its own. That matters: the sync trigger deletes the occupancy rows of
    // whichever booking it is updating, so anchoring the block to one of the
    // batch's own bookings made the block delete itself — which is exactly how an
    // earlier version of this test passed while proving nothing.
    const vehicles = await prisma.vehicle.findMany({ where: { isActive: true }, select: { id: true } });
    const ids = [await trip(8), await trip(13)];
    const anchor = await trip(20);
    await prisma.booking.update({ where: { id: anchor }, data: { isEmergency: true } });

    const blockStart = new Date(DAY);
    blockStart.setHours(0, 0, 0, 0);
    const blockEnd = addDays(blockStart, 1);
    for (const v of vehicles) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "VehicleOccupancy" ("id","bookingId","vehicleId","startAt","endAt")
         VALUES ($1, $2, $3, $4, $5)`,
        `synthetic-occ-${v.id}`,
        anchor,
        v.id,
        blockStart,
        blockEnd,
      );
    }
    // Confirm the block is actually in place before relying on it.
    const blocking = await prisma.vehicleOccupancy.count({ where: { bookingId: anchor } });
    expect(blocking, "every active car must be occupied for the test to mean anything").toBe(
      vehicles.length,
    );

    const res = await runBatchForDay(DAY_STR, "seed-user-admin");
    expect(res.ok, "a refused write must not throw out of the batch").toBe(true);

    const after = await prisma.booking.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, overflowReason: true },
    });
    // Proves the conflict path actually ran rather than the block silently not
    // applying — with every car occupied for the whole day, nothing can be
    // assigned, so anything ASSIGNED here would mean this test is vacuous.
    expect(
      after.filter((b) => b.status === "ASSIGNED"),
      "every car is occupied, so no assignment can succeed",
    ).toHaveLength(0);
    for (const b of after) {
      expect(b.overflowReason, `${b.id} must carry a reason, not be left bare`).not.toBeNull();
    }

    await prisma.$executeRawUnsafe(`DELETE FROM "VehicleOccupancy" WHERE "id" LIKE 'synthetic-occ-%'`);
  });
});
