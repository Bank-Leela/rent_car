import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { ensureOnCallRosterThrough } from "@/lib/booking/duty-roster";
import { localDayOfDbDate } from "@/lib/booking/db-date";

// เวร is a weekday duty — campus rounds 08:00–16:00, which the faculty does not
// run at the weekend. The auto-rotation had no notion of a week and filled all
// seven days, so every calendar showed a Saturday/Sunday เวร badge and that
// driver was "reserved all day" (excluded from every other pick) for a duty that
// did not exist.
//
// This is the subsystem the AGENTS.md note is about — the rule kept being
// re-derived — so the rule is pinned here rather than left to the comment.

// localDayOfDbDate, never the raw value or dbDateKey: writing local midnight of D
// into an @db.Date column stores D−1, so a Monday shift reads back as the Sunday.
// Asking `getDay()` of the raw value — or of dbDateKey's string — reports Sunday
// for a Monday duty, which is a weekend-shaped answer to a weekday question. The
// first version of this test did exactly that and "found" weekend shifts that
// were Mondays.
const dayKey = (stored: Date) => {
  const d = localDayOfDbDate(stored);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayKeyOfLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isWeekendStored = (stored: Date) => {
  const dow = localDayOfDbDate(stored).getDay();
  return dow === 0 || dow === 6;
};

/** The window this test reasons about: far enough out to be untouched by seed. */
function fridayAfter(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  return d;
}

const FRIDAY = fridayAfter(120);
const SATURDAY = new Date(FRIDAY.getTime() + 86_400_000);
const SUNDAY = new Date(FRIDAY.getTime() + 2 * 86_400_000);
const MONDAY = new Date(FRIDAY.getTime() + 3 * 86_400_000);

// This test's own Fri–Mon window, not "everything in the future". Asserting over
// the whole roster made the result depend on rows the seed or another test wrote
// — including weekend rows the OLD all-seven-days rotation left behind, which
// `ensureOnCallRosterThrough` deliberately never backfills or removes ("history
// is whatever it was"). Stale data is the prune script's job
// (scripts/prune-weekend-duty.ts); this file is about what the code writes.
async function shiftsThrough(end: Date) {
  return prisma.onCallShift.findMany({
    where: { date: { gte: FRIDAY, lte: end } },
    orderBy: { date: "asc" },
    select: { date: true, driverId: true },
  });
}

beforeAll(async () => {
  // The roster extends itself from wherever it currently ends, so this test has
  // to work against whatever the seed left behind rather than a clean slate.
  await ensureOnCallRosterThrough(MONDAY);
});

afterAll(async () => {
  // ONLY this test's own window. `date: { gt: new Date() }` deleted every future
  // เวร row in the database — the whole rest of the roster, on a shared dev DB —
  // and left the test order-dependent into the bargain.
  await prisma.onCallShift.deleteMany({ where: { date: { gte: FRIDAY, lte: MONDAY } } });
});

describe("เวร roster is weekdays only", () => {
  it("rosters no Saturday or Sunday", async () => {
    const rows = await shiftsThrough(MONDAY);
    const weekend = rows.filter((r) => isWeekendStored(r.date)).map((r) => dayKey(r.date));
    expect(weekend, `weekend เวร rostered: ${weekend.join(", ")}`).toEqual([]);
  });

  it("still rosters the weekdays either side of a weekend", async () => {
    const rows = await shiftsThrough(MONDAY);
    const keys = new Set(rows.map((r) => dayKey(r.date)));
    expect(keys.has(dayKeyOfLocal(FRIDAY)), "Friday rostered").toBe(true);
    expect(keys.has(dayKeyOfLocal(MONDAY)), "Monday rostered").toBe(true);
  });

  it("opening a Saturday tops the roster up to the Friday before it", async () => {
    // The point of the call is that the days around the viewed one are decided;
    // a weekend must not become a hole that stops the roster extending.
    await prisma.onCallShift.deleteMany({ where: { date: { gte: FRIDAY, lte: MONDAY } } });
    await ensureOnCallRosterThrough(SATURDAY);
    const keys = new Set((await shiftsThrough(MONDAY)).map((r) => dayKey(r.date)));
    expect(keys.has(dayKeyOfLocal(FRIDAY)), "Friday rostered from a Saturday view").toBe(true);
    expect(keys.has(dayKeyOfLocal(SATURDAY))).toBe(false);
    expect(keys.has(dayKeyOfLocal(SUNDAY))).toBe(false);
  });

  it("is idempotent on a weekend view — no unbounded re-rostering", async () => {
    // A weekend never gets a row, so the "already rostered?" early exit has to be
    // asked about the Friday. Asked about the Saturday it missed every time and
    // re-ran the whole fill loop on every render.
    await ensureOnCallRosterThrough(SATURDAY);
    const before = (await shiftsThrough(MONDAY)).length;
    const filled = await ensureOnCallRosterThrough(SATURDAY);
    const after = (await shiftsThrough(MONDAY)).length;
    expect(filled).toBe(0);
    expect(after).toBe(before);
  });

  it("a deliberate weekend override is left alone", async () => {
    // Auto-rotation skips the weekend; an admin upsert (matching-actions.ts) is a
    // decision, not a gap, so nothing here may undo or refuse it.
    const driver = await prisma.driver.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
    await prisma.onCallShift.upsert({
      where: { date: SATURDAY },
      create: { date: SATURDAY, driverId: driver.id },
      update: { driverId: driver.id },
    });
    await ensureOnCallRosterThrough(MONDAY);
    const still = await prisma.onCallShift.findUnique({ where: { date: SATURDAY }, select: { driverId: true } });
    expect(still?.driverId, "an explicit weekend เวร survives a top-up").toBe(driver.id);
  });
});
