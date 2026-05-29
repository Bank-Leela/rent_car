import { describe, expect, it } from "vitest";
import { classifyJobType, isOvernight } from "./classification";

const D = (s: string) => new Date(s);

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
