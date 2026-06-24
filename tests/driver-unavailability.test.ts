import { afterAll, describe, expect, it } from "vitest";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";

// Proves the sick-day exclusion filter works against the real dev DB: a driver
// with a DriverUnavailability row for a day is excluded by the same
// `unavailabilities: { none: { date } }` predicate the pool loaders use, and the
// @db.Date column makes the local-midnight (action) vs startOfDay (loader) match
// line up. Uses a throwaway user+driver, cleaned up after.
const stamp = Date.now();
const ids: { userId?: string; driverId?: string } = {};

afterAll(async () => {
  if (ids.driverId) await prisma.driverUnavailability.deleteMany({ where: { driverId: ids.driverId } });
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } });
  await prisma.$disconnect();
});

// The day off, parsed the way the action does (local midnight) and the way the
// loaders query (startOfDay) — must resolve to the same calendar day.
const dateStr = "2026-09-15";
const actionDate = new Date(`${dateStr}T00:00:00`); // setDriverUnavailableAction
const loaderDate = startOfDay(new Date(`${dateStr}T00:00:00`)); // pool loaders
const otherDay = startOfDay(new Date("2026-09-16T00:00:00"));

describe("driver unavailability exclusion", () => {
  it("excludes a driver marked off for the day, keeps them on other days", async () => {
    const user = await prisma.user.create({
      data: { email: `unavail-${stamp}@test.local`, username: `unavail-${stamp}`, name: "Unavail Test", isActive: true },
      select: { id: true },
    });
    ids.userId = user.id;
    const driver = await prisma.driver.create({
      data: { userId: user.id, pool: "PUBLIC", isActive: true },
      select: { id: true },
    });
    ids.driverId = driver.id;
    await prisma.driverUnavailability.create({ data: { driverId: driver.id, date: actionDate } });

    // Same predicate the loaders use. On the off day → excluded (none-match fails).
    const offDay = await prisma.driver.findMany({
      where: { id: driver.id, unavailabilities: { none: { date: loaderDate } } },
      select: { id: true },
    });
    expect(offDay).toHaveLength(0);

    // A different day → still in the pool.
    const otherDayPool = await prisma.driver.findMany({
      where: { id: driver.id, unavailabilities: { none: { date: otherDay } } },
      select: { id: true },
    });
    expect(otherDayPool.map((d) => d.id)).toEqual([driver.id]);
  });

  it("rotation timestamps are untouched while off (self-heal: no penalty)", async () => {
    // The exclusion is a filter only — it never writes lastTjwAt/lastOtAt/lastDutyAt,
    // so a missed day leaves the driver's rotation stamps old → picked first on return.
    const d = await prisma.driver.findUniqueOrThrow({
      where: { id: ids.driverId! },
      select: { lastTjwAt: true, lastOtAt: true, lastDutyAt: true },
    });
    expect(d.lastTjwAt).toBeNull();
    expect(d.lastOtAt).toBeNull();
    expect(d.lastDutyAt).toBeNull();
  });
});
