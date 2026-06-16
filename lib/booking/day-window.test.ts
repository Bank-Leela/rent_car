import { describe, it, expect } from "vitest";
import { daySpan, daysSpanned } from "./day-window";

// Local-time day boundaries for 2026-06-17 (the board uses local clock hours).
const dayStart = new Date(2026, 5, 17, 0, 0, 0); // Jun 17 00:00
const dayEnd = new Date(2026, 5, 18, 0, 0, 0); // Jun 18 00:00 (exclusive)

const at = (d: number, h: number, m = 0) => new Date(2026, 5, d, h, m, 0);

describe("daySpan — project a trip onto one viewed day", () => {
  it("same-day trip: real hours, no continuation", () => {
    const s = daySpan(at(17, 8, 30), at(17, 16, 0), dayStart, dayEnd);
    expect(s).toEqual({ startHour: 8.5, endHour: 16, continuesBefore: false, continuesAfter: false });
  });

  it("departure day: starts in-day, ends next day → runs to right edge + returns later", () => {
    const s = daySpan(at(17, 6, 0), at(18, 18, 0), dayStart, dayEnd);
    expect(s).toEqual({ startHour: 6, endHour: 24, continuesBefore: false, continuesAfter: true });
  });

  it("return day: started a previous day, ends in-day → runs from left edge to return time", () => {
    const s = daySpan(at(16, 6, 0), at(17, 18, 0), dayStart, dayEnd);
    expect(s).toEqual({ startHour: 0, endHour: 18, continuesBefore: true, continuesAfter: false });
  });

  it("middle day of a 3-day trip: occupies the whole day", () => {
    const s = daySpan(at(16, 6, 0), at(18, 12, 0), dayStart, dayEnd);
    expect(s).toEqual({ startHour: 0, endHour: 24, continuesBefore: true, continuesAfter: true });
  });

  it("ends exactly at the day's end (midnight): full width, not a continuation", () => {
    const s = daySpan(at(17, 9, 0), dayEnd, dayStart, dayEnd);
    expect(s).toEqual({ startHour: 9, endHour: 24, continuesBefore: false, continuesAfter: false });
  });

  it("starts exactly at the day's start: not a continuation", () => {
    const s = daySpan(dayStart, at(17, 10, 0), dayStart, dayEnd);
    expect(s).toEqual({ startHour: 0, endHour: 10, continuesBefore: false, continuesAfter: false });
  });
});

describe("daysSpanned — every day-cell a trip touches within a range", () => {
  const rangeStart = new Date(2026, 5, 14, 0, 0, 0); // Jun 14 (a Sunday grid start)
  const rangeEnd = new Date(2026, 5, 20, 23, 59, 59, 999); // Jun 20 end-of-day
  const keys = (ds: Date[]) => ds.map((d) => `${d.getMonth() + 1}-${d.getDate()}`);

  it("single-day trip → just its day", () => {
    expect(keys(daysSpanned(at(17, 8, 0), at(17, 16, 0), rangeStart, rangeEnd))).toEqual(["6-17"]);
  });

  it("two-day trip → departure + return day", () => {
    expect(keys(daysSpanned(at(16, 6, 0), at(17, 18, 0), rangeStart, rangeEnd))).toEqual(["6-16", "6-17"]);
  });

  it("three-day trip → every day it spans", () => {
    expect(keys(daysSpanned(at(16, 6, 0), at(18, 12, 0), rangeStart, rangeEnd))).toEqual(["6-16", "6-17", "6-18"]);
  });

  it("starts before the range → clamped to the range start", () => {
    const before = new Date(2026, 5, 12, 6, 0, 0); // Jun 12, before range
    expect(keys(daysSpanned(before, at(15, 10, 0), rangeStart, rangeEnd))).toEqual(["6-14", "6-15"]);
  });

  it("ends exactly at midnight → does not leak into the next day", () => {
    expect(keys(daysSpanned(at(16, 8, 0), new Date(2026, 5, 17, 0, 0, 0), rangeStart, rangeEnd))).toEqual(["6-16"]);
  });

  it("trip entirely outside the range → empty", () => {
    const a = new Date(2026, 5, 25, 8, 0, 0);
    const b = new Date(2026, 5, 26, 8, 0, 0);
    expect(daysSpanned(a, b, rangeStart, rangeEnd)).toEqual([]);
  });
});
