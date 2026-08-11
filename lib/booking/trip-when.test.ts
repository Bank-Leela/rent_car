import { describe, expect, it } from "vitest";
import { tripWhen, tripWhenRecurring } from "./trip-when";

// These strings are Thai-locale formatted, so the assertions check STRUCTURE
// (does a date appear, how many times) rather than exact glyphs — a locale-data
// bump should not redden the suite, but the duplicate-date bug must.

describe("tripWhen", () => {
  it("prints the date once for a same-day trip", () => {
    const s = new Date(2026, 7, 14, 8, 0);
    const e = new Date(2026, 7, 14, 12, 0);
    expect(tripWhen(s, e)).toContain("08:00");
    expect(tripWhen(s, e)).toContain("12:00");
    // "14" appears once (the day), not twice
    expect(tripWhen(s, e).match(/\b14\b/g)).toHaveLength(1);
  });

  it("keeps both dates when the trip spans midnight", () => {
    const s = new Date(2026, 7, 14, 22, 0);
    const e = new Date(2026, 7, 15, 6, 0);
    const out = tripWhen(s, e);
    expect(out).toMatch(/\b14\b/);
    expect(out).toMatch(/\b15\b/);
  });
});

describe("tripWhenRecurring", () => {
  // The bug: a series card printed "ศ. 14 ส.ค. 08:00–12:00" and then listed
  // "14 ส.ค. · 19 ส.ค. · …" underneath — the same date twice, and a weekday
  // that only described the first of thirteen days.
  it("drops the date, because the card lists every occurrence below it", () => {
    const s = new Date(2026, 7, 14, 8, 0);
    const e = new Date(2026, 7, 14, 12, 0);
    expect(tripWhenRecurring(s, e)).toBe("08:00–12:00");
  });

  it("carries no weekday, which would only be the first occurrence's", () => {
    // 2026-08-14 is a Friday; 2026-08-19 a Wednesday. A series over both must
    // not label itself with either.
    const out = tripWhenRecurring(new Date(2026, 7, 14, 8, 0), new Date(2026, 7, 14, 12, 0));
    expect(out).not.toMatch(/[ก-๙]/); // no Thai letters at all — digits and the dash only
  });

  it("still spells out both dates when an occurrence spans midnight", () => {
    // The date list cannot express "runs into the next day", so the full form stays.
    const s = new Date(2026, 7, 14, 22, 0);
    const e = new Date(2026, 7, 15, 6, 0);
    expect(tripWhenRecurring(s, e)).toBe(tripWhen(s, e));
  });
});
