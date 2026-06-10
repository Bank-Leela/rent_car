import { describe, it, expect } from "vitest";
import { solveDay, type SolverBookingInput, LONG_TRIP_KM } from "./batch-solver";
import { canChain, MAX_JOBS_PER_DAY, type DriverRotationState } from "./rotations";
import type { JobType } from "@prisma/client";

// Property/fuzz test: run many random days through the real solver and assert
// the scheduling rules hold on every single day, with rotation state carried
// across days (so the rotation paths are exercised too).

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function overlaps(a: { startAt: Date; endAt: Date }, b: { startAt: Date; endAt: Date }) {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

describe("solver invariants (fuzz, 500 random days)", () => {
  it("never violates the scheduling rules", () => {
    const rng = mulberry32(7);
    const randint = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
    const NUM_DRIVERS = 6;
    const NUM_DAYS = 500;
    const drivers: DriverRotationState[] = Array.from({ length: NUM_DRIVERS }, (_, i) => ({
      driverId: `D${i + 1}`,
      lastTjwAt: null, lastOtAt: null, lastDutyAt: null, lastAssignedAt: null, earningsScore: 0,
    }));
    const totals = new Map<string, number>(drivers.map((d) => [d.driverId, 0]));
    const base = new Date("2026-01-01T00:00:00");

    for (let day = 0; day < NUM_DAYS; day++) {
      const date = new Date(base); date.setDate(date.getDate() + day);
      const dutyDriverId = `D${(day % NUM_DRIVERS) + 1}`;
      const bookings: SolverBookingInput[] = [];
      let seq = 0;
      const dist = new Map<string, number | null>();
      const mk = (jt: JobType, sh: number, eh: number, d: number | null) => {
        const s = new Date(date); s.setHours(sh, 0, 0, 0);
        const e = new Date(date); e.setHours(eh, 0, 0, 0);
        const id = `${day}-${seq++}`;
        dist.set(id, d);
        bookings.push({ bookingId: id, jobType: jt, startAt: s, endAt: e, estimatedDistance: d, outOfProvince: jt === "TJW", submittedAt: new Date(date.getTime() + seq) });
      };
      for (let i = 0; i < randint(0, 2); i++) mk("TJW", 6, 18, randint(100, 800));
      for (let i = 0; i < randint(0, 3); i++) mk("OT", i % 2 ? 18 : 5, i % 2 ? 21 : 9, randint(20, 90));
      for (let i = 0; i < randint(0, 1); i++) mk("WERN", 8, 12, 15);
      for (let i = 0; i < randint(0, 5); i++) { const am = i % 2 === 0; mk("NORMAL", am ? 9 : 13, am ? 11 : 15, randint(5, 60)); }

      const out = solveDay({ date, bookings, drivers, dutyDriverId, activeTjwCommitments: [] });

      // (1) Completeness: every booking is either assigned or overflowed, once.
      expect(out.assignments.length + out.overflows.length).toBe(bookings.length);

      // (2) Secondary driver only on > 400 km trips, and never == primary.
      for (const a of out.assignments) {
        if (a.secondaryDriverId !== null) {
          expect(dist.get(a.bookingId)!).toBeGreaterThan(LONG_TRIP_KM);
          expect(a.secondaryDriverId).not.toBe(a.primaryDriverId);
        }
      }

      // (3) Per-driver day legality: <= 2 trips, no overlap, legal chain pair.
      for (const [, trips] of out.driverDay) {
        expect(trips.length).toBeLessThanOrEqual(MAX_JOBS_PER_DAY);
        for (let i = 0; i < trips.length; i++) {
          for (let j = i + 1; j < trips.length; j++) {
            expect(overlaps(trips[i]!, trips[j]!)).toBe(false);
          }
        }
        if (trips.length === 2) {
          expect(canChain(trips[1]!, [trips[0]!])).toBe(true);
        }
      }

      // carry rotation state forward
      const stamp = date;
      const W: Record<JobType, number> = { TJW: 4, OT: 3, WERN: 0, NORMAL: 2, SMUS: 2 };
      for (const a of out.assignments) {
        for (const id of [a.primaryDriverId, a.secondaryDriverId]) {
          if (!id) continue;
          totals.set(id, totals.get(id)! + 1);
          const d = drivers.find((x) => x.driverId === id)!;
          if (a.jobType === "TJW") d.lastTjwAt = stamp;
          else if (a.jobType === "OT") d.lastOtAt = stamp;
          else if (a.jobType === "WERN") d.lastDutyAt = stamp;
          d.lastAssignedAt = stamp;
          d.earningsScore += W[a.jobType] ?? 0;
        }
      }
    }

    // (4) Fairness: spread between busiest and idlest driver stays small.
    const counts = [...totals.values()];
    const spread = Math.max(...counts) - Math.min(...counts);
    expect(spread).toBeLessThanOrEqual(Math.max(...counts) * 0.05); // within 5%
  }, 30000);
});
