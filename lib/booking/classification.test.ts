import { describe, expect, it } from "vitest";
import { classifyJobType, isOvernight, tripEffort } from "./classification";

const D = (s: string) => new Date(s);

describe("tripEffort (duration-weighted fairness ledger)", () => {
  it("WERN scores 0 (duty driver keeps its own rotation)", () => {
    expect(tripEffort("WERN", D("2026-06-10T08:00:00"), D("2026-06-10T12:00:00"))).toBe(0);
  });

  it("NORMAL = real hours", () => {
    expect(tripEffort("NORMAL", D("2026-06-10T09:00:00"), D("2026-06-10T11:00:00"))).toBe(2);
  });

  it("OT = real hours", () => {
    expect(tripEffort("OT", D("2026-06-10T05:00:00"), D("2026-06-10T09:00:00"))).toBe(4);
    expect(tripEffort("OT", D("2026-06-10T18:00:00"), D("2026-06-10T21:00:00"))).toBe(3);
  });

  it("same-day TJW = one TJW-day = 12", () => {
    expect(tripEffort("TJW", D("2026-06-10T06:00:00"), D("2026-06-10T18:00:00"))).toBe(12);
  });

  it("multi-day TJW = spanDays x 12 (the case this change exists to fix)", () => {
    // Jun 9 -> Jun 10 = 2 days
    expect(tripEffort("TJW", D("2026-06-09T06:00:00"), D("2026-06-10T18:00:00"))).toBe(24);
    // Jun 9 -> Jun 11 = 3 days
    expect(tripEffort("TJW", D("2026-06-09T06:00:00"), D("2026-06-11T18:00:00"))).toBe(36);
  });

  it("a short-hours TJW still counts a full TJW-day", () => {
    expect(tripEffort("TJW", D("2026-06-10T06:00:00"), D("2026-06-10T08:00:00"))).toBe(12);
  });
});

describe("isOvernight", () => {
  it("returns true when end is on a later calendar day", () => {
    expect(isOvernight(D("2026-06-10T22:00:00"), D("2026-06-11T01:00:00"))).toBe(true);
  });
  it("returns false for same-day trips that end at midnight exactly", () => {
    expect(isOvernight(D("2026-06-10T08:00:00"), D("2026-06-10T23:59:00"))).toBe(false);
  });
  it("returns true for multi-day trips", () => {
    expect(isOvernight(D("2026-06-10T08:00:00"), D("2026-06-14T18:00:00"))).toBe(true);
  });
});

describe("classifyJobType", () => {
  it("TJW = out-of-province AND overnight", () => {
    expect(
      classifyJobType({
        startAt: D("2026-06-10T08:00:00"),
        endAt: D("2026-06-12T18:00:00"),
        outOfProvince: true,
      }),
    ).toBe("TJW");
  });

  it("Bangkok overnight is OT, not TJW (Update 2 bug-fix)", () => {
    expect(
      classifyJobType({
        startAt: D("2026-06-10T22:00:00"),
        endAt: D("2026-06-11T01:30:00"),
        outOfProvince: false,
      }),
    ).toBe("OT");
  });

  it("Out-of-province same-day is OT if outside working window", () => {
    expect(
      classifyJobType({
        startAt: D("2026-06-10T05:00:00"),
        endAt: D("2026-06-10T15:00:00"),
        outOfProvince: true,
      }),
    ).toBe("OT");
  });

  it("Out-of-province same-day inside working window is NORMAL", () => {
    expect(
      classifyJobType({
        startAt: D("2026-06-10T09:00:00"),
        endAt: D("2026-06-10T15:00:00"),
        outOfProvince: true,
      }),
    ).toBe("NORMAL");
  });

  it("Start before 08:00 triggers OT", () => {
    expect(
      classifyJobType({
        startAt: D("2026-06-10T07:00:00"),
        endAt: D("2026-06-10T11:00:00"),
        outOfProvince: false,
      }),
    ).toBe("OT");
  });

  it("End after 16:00 triggers OT", () => {
    expect(
      classifyJobType({
        startAt: D("2026-06-10T12:00:00"),
        endAt: D("2026-06-10T17:30:00"),
        outOfProvince: false,
      }),
    ).toBe("OT");
  });

  it("End at 16:00 exactly stays NORMAL", () => {
    expect(
      classifyJobType({
        startAt: D("2026-06-10T12:00:00"),
        endAt: D("2026-06-10T16:00:00"),
        outOfProvince: false,
      }),
    ).toBe("NORMAL");
  });

  it("End at 16:01 trips OT", () => {
    expect(
      classifyJobType({
        startAt: D("2026-06-10T12:00:00"),
        endAt: D("2026-06-10T16:01:00"),
        outOfProvince: false,
      }),
    ).toBe("OT");
  });
});

describe("classifyJobType — work-window boundaries", () => {
  const local = { outOfProvince: false };

  it("ends exactly 16:00 → NORMAL; 16:30 → OT; 17:00 → OT", () => {
    expect(classifyJobType({ ...local, startAt: D("2026-06-10T09:00:00"), endAt: D("2026-06-10T16:00:00") })).toBe("NORMAL");
    expect(classifyJobType({ ...local, startAt: D("2026-06-10T12:00:00"), endAt: D("2026-06-10T16:30:00") })).toBe("OT");
    expect(classifyJobType({ ...local, startAt: D("2026-06-10T12:00:00"), endAt: D("2026-06-10T17:00:00") })).toBe("OT");
  });

  it("ends 16:00:30 (sub-minute past 16:00) → OT, not NORMAL", () => {
    // Regression: getMinutes()===0 hid the seconds, classifying 16:00:30 NORMAL.
    expect(
      classifyJobType({ ...local, startAt: D("2026-06-10T12:00:00"), endAt: new Date(2026, 5, 10, 16, 0, 30) }),
    ).toBe("OT");
  });

  it("starts exactly 08:00 → NORMAL; 07:59 → OT", () => {
    expect(classifyJobType({ ...local, startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-10T10:00:00") })).toBe("NORMAL");
    expect(classifyJobType({ ...local, startAt: D("2026-06-10T07:59:00"), endAt: D("2026-06-10T10:00:00") })).toBe("OT");
  });

  it("out-of-province overnight is TJW; same-area overnight is OT (order matters)", () => {
    expect(classifyJobType({ outOfProvince: true, startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-11T08:00:00") })).toBe("TJW");
    expect(classifyJobType({ outOfProvince: false, startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-11T08:00:00") })).toBe("OT");
  });
});

describe("isOvernight — exact midnight", () => {
  it("ending exactly at next-day 00:00 is overnight (later calendar day)", () => {
    expect(isOvernight(D("2026-06-10T20:00:00"), new Date(2026, 5, 11, 0, 0, 0))).toBe(true);
  });
});

describe("tripEffort — fractional NORMAL hours", () => {
  it("credits real fractional duration", () => {
    expect(tripEffort("NORMAL", D("2026-06-10T09:00:00"), D("2026-06-10T10:30:00"))).toBe(1.5);
  });
});
