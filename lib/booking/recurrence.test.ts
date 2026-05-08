import { describe, expect, it } from "vitest";
import { expandRecurringDates, buildRrule } from "./recurrence";

describe("expandRecurringDates", () => {
  it("returns Mondays + Thursdays in a 14-day window", () => {
    const dates = expandRecurringDates({
      startDate: new Date("2026-06-01T08:00:00Z"), // Mon
      endDate: new Date("2026-06-14T23:59:00Z"),
      weekdays: [1, 4],
    });
    expect(dates.map((d) => d.getUTCDate())).toEqual([1, 4, 8, 11]);
  });

  it("returns empty when startDate > endDate", () => {
    const dates = expandRecurringDates({
      startDate: new Date("2026-06-10"),
      endDate: new Date("2026-06-01"),
      weekdays: [1],
    });
    expect(dates).toEqual([]);
  });

  it("ignores invalid weekdays implicitly via empty set", () => {
    const dates = expandRecurringDates({
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-30"),
      weekdays: [],
    });
    expect(dates).toEqual([]);
  });
});

describe("buildRrule", () => {
  it("produces an iCal weekly RRULE", () => {
    expect(buildRrule([1, 4])).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,TH");
  });
});
