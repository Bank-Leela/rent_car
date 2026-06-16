import { describe, it, expect } from "vitest";
import { daySpan } from "./day-window";

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
