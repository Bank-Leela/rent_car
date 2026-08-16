import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays, startOfDay } from "date-fns";

import { prisma } from "@/lib/db";
import { ensureOnCallRosterThrough } from "@/lib/booking/duty-roster";

/**
 * Leave must actually keep a driver off duty.
 *
 * All three of these paths keyed leave from the value Prisma returns for a
 * `@db.Date` column, which is a day off from the day the leave is about, so the
 * lookup never matched and the check silently passed everyone. A green suite did
 * not notice because nothing asserted the OUTCOME — only the symmetric queries.
 *
 * The shape of each test is: make every driver but one unavailable, then assert
 * the only legal choice is the one who is available. If leave is ignored the
 * rotation picks by seniority instead and these fail.
 */
const REASON = "LEAVE-RESPECTED-TEST";
// Far enough out to be past the rostered horizon, inside MAX_LOOKAHEAD_DAYS (370).
//
// Nudged onto a Tue–Fri, because a bare +300 made this suite fail on the calendar
// rather than on the code. เวร is not rostered at the weekend (duty-roster.ts
// skips Sat/Sun), so on any real-world day where today+300 landed on Sat or Sun —
// two days in seven — the first two tests asserted "the day should get rostered"
// about a day that correctly has no เวร. The third test needs TARGET-1 rostered
// as well, so Monday is out too: the window is Tue–Fri.
const TARGET = (() => {
  const d = startOfDay(addDays(new Date(), 300));
  while (d.getDay() < 2 || d.getDay() > 5) d.setDate(d.getDate() + 1);
  return d;
})();

let driverIds: string[] = [];

beforeEach(async () => {
  const drivers = await prisma.driver.findMany({
    where: { isActive: true, user: { is: { isActive: true } } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  driverIds = drivers.map((d) => d.id);
  expect(driverIds.length, "needs a seeded fleet").toBeGreaterThan(1);
  // A clean slate for the window this test writes into.
  await prisma.onCallShift.deleteMany({ where: { date: { gte: addDays(TARGET, -5) } } });
  await prisma.driverUnavailability.deleteMany({ where: { reason: REASON } });
});

afterEach(async () => {
  await prisma.driverUnavailability.deleteMany({ where: { reason: REASON } });
  await prisma.onCallShift.deleteMany({ where: { date: { gte: addDays(TARGET, -5) } } });
});

describe("เวร roster respects leave", () => {
  it("never rosters a driver who is on leave that day", async () => {
    const [available, ...off] = driverIds;
    for (const id of off) {
      await prisma.driverUnavailability.create({
        data: { driverId: id, date: TARGET, reason: REASON },
      });
    }

    await ensureOnCallRosterThrough(TARGET);

    const shift = await prisma.onCallShift.findUnique({ where: { date: TARGET } });
    expect(shift, "the day should get rostered").not.toBeNull();
    expect(
      shift!.driverId,
      "the only driver not on leave is the only legal เวร for that day",
    ).toBe(available);
  });

  it("still names someone when EVERY driver is on leave — deliberate, not a leak", async () => {
    // pickAutoDutyDriver falls back to the full pool when nobody is present:
    // "If every candidate is away, fall back to the full pool so a duty is still
    // named" (lib/booking/duty-assignment.ts). Pinned here so the fix above is not
    // mistaken for this case, and so the choice stays a choice — if the office
    // would rather see an unmanned day than an absent name, that is a one-line
    // change in pickAutoDutyDriver, not a bug in the leave lookup.
    for (const id of driverIds) {
      await prisma.driverUnavailability.create({
        data: { driverId: id, date: TARGET, reason: REASON },
      });
    }

    await ensureOnCallRosterThrough(TARGET);

    const shift = await prisma.onCallShift.findUnique({ where: { date: TARGET } });
    expect(shift, "the fallback names a driver rather than leaving the day empty").not.toBeNull();
    expect(driverIds).toContain(shift!.driverId);
  });

  it("does not treat the day BEFORE a leave day as unavailable", async () => {
    // The mirror image of the bug: keyed a day early, the check also blocked the
    // wrong day, pushing that day's duty onto someone else.
    const dayBefore = addDays(TARGET, -1);
    const [_first, ...off] = driverIds;
    void _first;
    for (const id of off) {
      await prisma.driverUnavailability.create({
        data: { driverId: id, date: TARGET, reason: REASON },
      });
    }

    await ensureOnCallRosterThrough(TARGET);

    const before = await prisma.onCallShift.findUnique({ where: { date: dayBefore } });
    expect(before, "the previous day is rostered too").not.toBeNull();
    // Nobody is on leave on dayBefore, so any driver is legal there — including
    // one who is off the NEXT day. A day-early key would have excluded them.
    expect(driverIds).toContain(before!.driverId);
  });
});
