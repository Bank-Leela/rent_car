import { afterEach, describe, expect, it } from "vitest";
import { addDays, startOfDay } from "date-fns";

import { prisma } from "@/lib/db";
import { dbDateKey, driverDayKey } from "@/lib/booking/db-date";

/**
 * The real DB round trip on a `@db.Date` column that the suite never had.
 *
 * A previous audit pass dismissed the day-shift as a false positive because every
 * WHERE-clause round-trip is symmetric and the app therefore "behaves". That
 * generalisation was wrong: three leave/duty checks derived a key from the value
 * Prisma returned and compared it against a locally-built day, which is 24 h off.
 * These tests pin both halves — the shift is real, and dbDateKey is immune to it.
 */
const REASON = "DBDATE-ROUNDTRIP-TEST";

afterEach(async () => {
  await prisma.driverUnavailability.deleteMany({ where: { reason: REASON } });
});

describe("@db.Date round trip", () => {
  it("stores a local midnight under a date that startOfDay() cannot recover", async () => {
    const driver = await prisma.driver.findFirstOrThrow({ select: { id: true } });
    // A fixed far-future day so the assertion does not depend on today.
    const localDay = startOfDay(new Date("2029-04-11T00:00:00"));

    await prisma.driverUnavailability.create({
      data: { driverId: driver.id, date: localDay, reason: REASON },
    });
    const row = await prisma.driverUnavailability.findFirstOrThrow({ where: { reason: REASON } });

    // The symmetric query works — this is why the app appears correct.
    const found = await prisma.driverUnavailability.findFirst({
      where: { driverId: driver.id, date: localDay },
    });
    expect(found, "querying with the same local midnight finds the row").not.toBeNull();

    // ...but the two keying styles the buggy call sites used do NOT agree.
    const offset = new Date().getTimezoneOffset(); // minutes WEST of UTC; +07 => -420
    if (offset < 0) {
      expect(
        startOfDay(row.date).getTime(),
        "east of UTC, the read-back value is an earlier day than the one written",
      ).not.toBe(localDay.getTime());
    }

    // dbDateKey agrees on both sides regardless of offset. This is the contract
    // every leave/duty lookup now depends on.
    expect(dbDateKey(row.date)).toBe(dbDateKey(localDay));
    expect(driverDayKey(driver.id, row.date)).toBe(driverDayKey(driver.id, localDay));
  });

  it("does not collide across adjacent days", async () => {
    // The failure mode being guarded is an off-by-one-DAY, so a key that matched
    // neighbours would hide it.
    const driver = await prisma.driver.findFirstOrThrow({ select: { id: true } });
    const day = startOfDay(new Date("2029-04-11T00:00:00"));
    await prisma.driverUnavailability.create({
      data: { driverId: driver.id, date: day, reason: REASON },
    });
    const row = await prisma.driverUnavailability.findFirstOrThrow({ where: { reason: REASON } });

    expect(dbDateKey(row.date)).not.toBe(dbDateKey(addDays(day, 1)));
    expect(dbDateKey(row.date)).not.toBe(dbDateKey(addDays(day, -1)));
  });

  it("keys every day of a leave range distinctly and matches each back", async () => {
    const driver = await prisma.driver.findFirstOrThrow({ select: { id: true } });
    const days = [0, 1, 2, 3, 4].map((n) => addDays(startOfDay(new Date("2029-05-14T00:00:00")), n));
    for (const d of days) {
      await prisma.driverUnavailability.create({
        data: { driverId: driver.id, date: d, reason: REASON },
      });
    }
    const rows = await prisma.driverUnavailability.findMany({ where: { reason: REASON } });
    expect(rows).toHaveLength(days.length);

    // Build the lookup the way the fixed call sites do, then ask for each real day.
    const off = new Set(rows.map((r) => driverDayKey(r.driverId, r.date)));
    for (const d of days) {
      expect(off.has(driverDayKey(driver.id, d)), `day ${d.toDateString()} must be found`).toBe(true);
    }
    // And a day just outside the range must not be.
    expect(off.has(driverDayKey(driver.id, addDays(days[4]!, 1)))).toBe(false);
  });
});
