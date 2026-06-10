import { describe, it, expect } from "vitest";
import { mulberry32, generateDay, simulate, type DayContext } from "./simulation";

const sameCalendarDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function collectTjw(multiDayTjwProb: number) {
  const rng = mulberry32(123);
  const base = new Date("2026-01-01T00:00:00");
  const tjw: { startAt: Date; endAt: Date }[] = [];
  for (let day = 0; day < 200; day++) {
    const date = new Date(base);
    date.setDate(date.getDate() + day);
    for (const b of generateDay(rng, date, { numDrivers: 6, multiDayTjwProb })) {
      if (b.jobType === "TJW") tjw.push({ startAt: b.startAt, endAt: b.endAt });
    }
  }
  return tjw;
}

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("returns values in [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("generateDay — multi-day TJW", () => {
  it("makes every TJW span more than one calendar day when prob = 1", () => {
    const tjw = collectTjw(1);
    expect(tjw.length).toBeGreaterThan(0);
    for (const t of tjw) expect(sameCalendarDay(t.startAt, t.endAt)).toBe(false);
  });

  it("keeps every TJW same-day when prob = 0", () => {
    const tjw = collectTjw(0);
    expect(tjw.length).toBeGreaterThan(0);
    for (const t of tjw) expect(sameCalendarDay(t.startAt, t.endAt)).toBe(true);
  });

  it("tags TJW out-of-province", () => {
    const rng = mulberry32(5);
    const date = new Date("2026-03-01T00:00:00");
    let sawTjw = false;
    for (let i = 0; i < 50; i++) {
      for (const b of generateDay(rng, date, { numDrivers: 6, multiDayTjwProb: 0.5 })) {
        if (b.jobType === "TJW") {
          sawTjw = true;
          expect(b.outOfProvince).toBe(true);
        }
      }
    }
    expect(sawTjw).toBe(true);
  });
});

describe("simulate — day-loop + cross-day commitment carry", () => {
  it("calls onDay once per day and keeps every day complete", () => {
    const seen: DayContext[] = [];
    simulate({ days: 30, seed: 1, onDay: (ctx) => seen.push(ctx) });
    expect(seen).toHaveLength(30);
    for (const ctx of seen) {
      expect(ctx.output.assignments.length + ctx.output.overflows.length).toBe(
        ctx.input.bookings.length,
      );
    }
  });

  it("carries multi-day TJW commitments into later days (old sim never did)", () => {
    const withCommitments: number[] = [];
    simulate({
      days: 60,
      seed: 1,
      multiDayTjwProb: 1,
      onDay: (ctx) => {
        if (ctx.activeTjwCommitments.length > 0) withCommitments.push(ctx.day);
      },
    });
    // With every TJW spanning >1 day, some later days must inherit an open commitment.
    expect(withCommitments.length).toBeGreaterThan(0);
  });

  it("is deterministic: same seed → identical metrics", () => {
    const a = simulate({ days: 50, seed: 99 });
    const b = simulate({ days: 50, seed: 99 });
    expect(a.metrics).toEqual(b.metrics);
  });
});
