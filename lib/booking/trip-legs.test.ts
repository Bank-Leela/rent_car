import { describe, expect, it } from "vitest";
import { tripLegs, legsOverlap, minLegGapMinutes } from "./trip-legs";

const at = (h: number, m = 0) => {
  const d = new Date(2026, 5, 26);
  d.setHours(h, m, 0, 0);
  return d;
};
const wait = (s: Date, e: Date) => ({
  startAt: s,
  endAt: e,
  waitAtDestination: true,
  dropOffDone: null,
  pickupReturnTime: null,
});
const split = (s: Date, drop: Date, ret: string, e: Date) => ({
  startAt: s,
  endAt: e,
  waitAtDestination: false,
  dropOffDone: drop,
  pickupReturnTime: ret,
});

describe("tripLegs", () => {
  it("returns one interval when waiting", () => {
    expect(tripLegs(wait(at(8), at(12)))).toHaveLength(1);
  });
  it("returns one interval when no-wait but data missing (back-compat)", () => {
    expect(tripLegs({ ...wait(at(8), at(12)), waitAtDestination: false })).toHaveLength(1);
  });
  it("returns two intervals for a no-wait split", () => {
    const legs = tripLegs(split(at(8), at(10), "15:30", at(18)));
    expect(legs).toHaveLength(2);
    expect(legs[0]).toEqual({ startAt: at(8), endAt: at(10) });
    expect(legs[1]).toEqual({ startAt: at(15, 30), endAt: at(18) });
  });
});

describe("legsOverlap", () => {
  it("false when the other trip sits entirely in the free gap", () => {
    expect(legsOverlap(split(at(8), at(10), "15:30", at(18)), wait(at(11), at(13)))).toBe(false);
  });
  it("true when the other trip hits leg 1", () => {
    expect(legsOverlap(split(at(8), at(10), "15:30", at(18)), wait(at(9), at(9, 30)))).toBe(true);
  });
  it("true when the other trip hits leg 2", () => {
    expect(legsOverlap(split(at(8), at(10), "15:30", at(18)), wait(at(16), at(17)))).toBe(true);
  });
  it("touching edges do not overlap", () => {
    expect(legsOverlap(wait(at(8), at(10)), wait(at(10), at(12)))).toBe(false);
  });
});

describe("minLegGapMinutes", () => {
  it("measures the smallest gap to any leg", () => {
    // other ends 09:00; leg 1 starts 10:00 → 60 min
    expect(minLegGapMinutes(split(at(10), at(12), "15:30", at(18)), wait(at(7), at(9)))).toBe(60);
  });
  it("is 0 when a leg overlaps", () => {
    expect(minLegGapMinutes(split(at(8), at(10), "15:30", at(18)), wait(at(9), at(11)))).toBe(0);
  });
});
