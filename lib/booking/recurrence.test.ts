import { describe, expect, it } from "vitest";
import { expandRecurringDates, buildRrule } from "./recurrence";

// All inputs are LOCAL Date objects, matching what the form (datetime-local +
// date-only picker) and the schema produce. Weekdays use the JS local
// convention (0=Sun..6=Sat), same as the weekday picker.
const local = (y: number, m: number, d: number, h = 8) => new Date(y, m - 1, d, h, 0, 0, 0);

describe("expandRecurringDates", () => {
  it("returns each Mon/Wed/Fri in the window, INCLUDING the end date", () => {
    // Wed 2026-07-01 .. Wed 2026-07-15, repeat Mon/Wed/Fri.
    const dates = expandRecurringDates({
      startDate: local(2026, 7, 1), // Wed, 08:00
      endDate: local(2026, 7, 15, 0), // until = local midnight on the 15th
      weekdays: [1, 3, 5],
    });
    // Wed1, Fri3, Mon6, Wed8, Fri10, Mon13, Wed15 — the 15th must be present.
    expect(dates.map((d) => d.getDate())).toEqual([1, 3, 6, 8, 10, 13, 15]);
  });

  it("matches the LOCAL weekday only — an early-morning start never leaks the next day", () => {
    // Regression: 05:00 starts used to match both the UTC and local weekday, so
    // a Mondays-only series also produced every Tuesday.
    const dates = expandRecurringDates({
      startDate: local(2026, 7, 6, 5), // Mon, 05:00
      endDate: local(2026, 7, 27, 5),
      weekdays: [1], // Mondays only
    });
    expect(dates.map((d) => d.getDate())).toEqual([6, 13, 20, 27]);
    expect(dates.every((d) => d.getDay() === 1)).toBe(true);
  });

  it("returns empty when startDate > endDate", () => {
    const dates = expandRecurringDates({
      startDate: local(2026, 6, 10),
      endDate: local(2026, 6, 1),
      weekdays: [1],
    });
    expect(dates).toEqual([]);
  });

  it("returns empty for an empty weekday set", () => {
    const dates = expandRecurringDates({
      startDate: local(2026, 6, 1),
      endDate: local(2026, 6, 30),
      weekdays: [],
    });
    expect(dates).toEqual([]);
  });

  it("includes the start date itself when its weekday is selected", () => {
    const dates = expandRecurringDates({
      startDate: local(2026, 7, 1), // Wed
      endDate: local(2026, 7, 8),
      weekdays: [3], // Wed
    });
    expect(dates.map((d) => d.getDate())).toEqual([1, 8]);
  });
});

describe("buildRrule", () => {
  it("produces an iCal weekly RRULE", () => {
    expect(buildRrule([1, 4])).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,TH");
  });
});
