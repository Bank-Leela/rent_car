import { describe, it, expect } from "vitest";
import { simulate, type DayContext } from "./simulation";
import { canChain, MAX_JOBS_PER_DAY } from "./rotations";
import { LONG_TRIP_KM } from "./batch-solver";
import { WORK_DAY_END_HOUR } from "./classification";

// Property/fuzz test: run many random days through the real solver — now WITH
// multi-day TJW trips carried across days (the prior version always passed
// activeTjwCommitments: []) — and assert the scheduling + cross-day TJW rules
// hold on every single day. The simulation core lives in ./simulation.

function overlaps(a: { startAt: Date; endAt: Date }, b: { startAt: Date; endAt: Date }) {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}
function startOfDayMs(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r.getTime();
}
function sameCalendarDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function assertDay(
  ctx: DayContext,
  trips: Map<string, number>,
  availableDays: Map<string, number>,
) {
  const { date, output, input, activeTjwCommitments, dutyDriverId } = ctx;

  // Classify drivers by their active TJW commitment today.
  const away = new Set<string>();
  const returning = new Set<string>();
  for (const c of activeTjwCommitments) {
    // (7) Freed on return: no commitment is stale (already ended before today).
    expect(c.endAt.getTime()).toBeGreaterThan(startOfDayMs(date));
    const returnee = sameCalendarDay(c.endAt, date) && c.endAt.getHours() < WORK_DAY_END_HOUR;
    if (returnee) returning.add(c.driverId);
    else away.add(c.driverId);
  }
  for (const id of away) returning.delete(id); // a driver both away and returning → away wins

  const dist = new Map(input.bookings.map((b) => [b.bookingId, b.estimatedDistance]));

  for (const a of output.assignments) {
    // (1) Away means away: a driver mid multi-day TJW is never assigned today.
    expect(away.has(a.primaryDriverId)).toBe(false);
    if (a.secondaryDriverId) expect(away.has(a.secondaryDriverId)).toBe(false);

    // (2) Return-day driver is OT-only (Phase C), never TJW/WERN/NORMAL.
    const touchesReturnee =
      returning.has(a.primaryDriverId) || (a.secondaryDriverId !== null && returning.has(a.secondaryDriverId));
    if (touchesReturnee) expect(a.jobType).toBe("OT");

    // (4) Secondary only on > 400 km trips, never == primary.
    if (a.secondaryDriverId !== null) {
      expect(dist.get(a.bookingId)!).toBeGreaterThan(LONG_TRIP_KM);
      expect(a.secondaryDriverId).not.toBe(a.primaryDriverId);
    }
  }

  // (5) Completeness: every booking assigned or overflowed exactly once.
  expect(output.assignments.length + output.overflows.length).toBe(input.bookings.length);

  // (3) Per-driver day legality: <= 2 trips, no overlap, legal chain pair.
  for (const [, dayTrips] of output.driverDay) {
    expect(dayTrips.length).toBeLessThanOrEqual(MAX_JOBS_PER_DAY);
    for (let i = 0; i < dayTrips.length; i++) {
      for (let j = i + 1; j < dayTrips.length; j++) {
        expect(overlaps(dayTrips[i]!, dayTrips[j]!)).toBe(false);
      }
    }
    if (dayTrips.length === 2) expect(canChain(dayTrips[1]!, [dayTrips[0]!])).toBe(true);
  }

  // Accumulate availability-adjusted fairness inputs (§6.3).
  const todays = new Map<string, number>();
  for (const a of output.assignments) {
    todays.set(a.primaryDriverId, (todays.get(a.primaryDriverId) ?? 0) + 1);
    if (a.secondaryDriverId) todays.set(a.secondaryDriverId, (todays.get(a.secondaryDriverId) ?? 0) + 1);
  }
  for (const d of ctx.drivers) {
    trips.set(d.driverId, (trips.get(d.driverId) ?? 0) + (todays.get(d.driverId) ?? 0));
    const unavailable = away.has(d.driverId) || d.driverId === dutyDriverId;
    if (!unavailable) availableDays.set(d.driverId, (availableDays.get(d.driverId) ?? 0) + 1);
  }
}

describe("solver invariants (fuzz, 500 random days, multi-day TJW)", () => {
  it("never violates the scheduling or cross-day TJW rules", () => {
    const trips = new Map<string, number>();
    const availableDays = new Map<string, number>();

    simulate({
      days: 500,
      seed: 7,
      multiDayTjwProb: 0.4,
      onDay: (ctx) => assertDay(ctx, trips, availableDays),
    });

    // (6.3) Fairness as a SOFT, availability-adjusted assertion: trips per
    // available-day should be close across drivers. Raw trip counts are NOT
    // asserted because away-on-TJW drivers legitimately do fewer trips.
    const rates = [...trips.keys()].map((id) => trips.get(id)! / Math.max(1, availableDays.get(id) ?? 0));
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    const spread = Math.max(...rates) - Math.min(...rates);
    // Calibrated to the seed-7 baseline (observed spread/avg ≈ 0.033); 0.06
    // leaves a modest margin while still catching a real fairness regression.
    expect(spread).toBeLessThanOrEqual(avg * 0.06);
  }, 30000);
});
