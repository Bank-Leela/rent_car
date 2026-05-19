import { describe, expect, it } from "vitest";
import {
  classifyTier,
  canTakeTrip,
  pickNextOnCallDriver,
  rankCandidates,
  TIER_WEIGHT,
} from "./auto-assign";
import { BANGKOK_PROVINCE } from "./rules";

describe("classifyTier", () => {
  it("uses the explicit tier when set", () => {
    expect(classifyTier({ jobTier: "SCHOOL", province: "เชียงใหม่" })).toBe("SCHOOL");
    expect(classifyTier({ jobTier: "INTERNATIONAL", province: BANGKOK_PROVINCE })).toBe("INTERNATIONAL");
  });

  it("defaults to ON_CALL when province is Bangkok and no override", () => {
    expect(classifyTier({ jobTier: null, province: BANGKOK_PROVINCE })).toBe("ON_CALL");
  });

  it("defaults to PROVINCIAL when province is anything else", () => {
    expect(classifyTier({ jobTier: null, province: "เชียงใหม่" })).toBe("PROVINCIAL");
    expect(classifyTier({ jobTier: undefined, province: "พังงา" })).toBe("PROVINCIAL");
  });
});

describe("TIER_WEIGHT", () => {
  it("orders international > school > provincial > on-call", () => {
    expect(TIER_WEIGHT.INTERNATIONAL).toBeGreaterThan(TIER_WEIGHT.SCHOOL);
    expect(TIER_WEIGHT.SCHOOL).toBeGreaterThan(TIER_WEIGHT.PROVINCIAL);
    expect(TIER_WEIGHT.PROVINCIAL).toBeGreaterThan(TIER_WEIGHT.ON_CALL);
  });
});

describe("canTakeTrip", () => {
  const morning = {
    startAt: new Date("2026-06-10T08:00:00"),
    endAt: new Date("2026-06-10T11:00:00"),
  };
  const afternoonOk = {
    startAt: new Date("2026-06-10T13:00:00"), // 2h after morning.endAt
    endAt: new Date("2026-06-10T16:00:00"),
  };
  const afternoonTooSoon = {
    startAt: new Date("2026-06-10T12:30:00"),
    endAt: new Date("2026-06-10T15:00:00"),
  };

  it("allows the first trip of the day", () => {
    expect(canTakeTrip(morning, [])).toBe(true);
  });

  it("allows afternoon after a morning trip if buffered 2h+", () => {
    expect(canTakeTrip(afternoonOk, [morning])).toBe(true);
  });

  it("rejects afternoon when the 2-hour buffer isn't met", () => {
    expect(canTakeTrip(afternoonTooSoon, [morning])).toBe(false);
  });

  it("rejects a third trip on the same day", () => {
    expect(canTakeTrip(afternoonOk, [morning, afternoonOk])).toBe(false);
  });

  it("rejects an afternoon-then-morning sequence", () => {
    const earlierMorning = {
      startAt: new Date("2026-06-10T06:00:00"),
      endAt: new Date("2026-06-10T07:30:00"),
    };
    expect(canTakeTrip(earlierMorning, [afternoonOk])).toBe(false);
  });
});

describe("rankCandidates", () => {
  it("picks lowest earnings score first", () => {
    const ranked = rankCandidates([
      { driverId: "A", earningsScore: 10, tripsThisMonth: 3, tieBreaker: 0 },
      { driverId: "B", earningsScore: 4, tripsThisMonth: 2, tieBreaker: 1 },
      { driverId: "C", earningsScore: 7, tripsThisMonth: 1, tieBreaker: 2 },
    ]);
    expect(ranked).toEqual(["B", "C", "A"]);
  });

  it("breaks ties on trip count, then on tieBreaker order", () => {
    const ranked = rankCandidates([
      { driverId: "A", earningsScore: 5, tripsThisMonth: 3, tieBreaker: 0 },
      { driverId: "B", earningsScore: 5, tripsThisMonth: 1, tieBreaker: 5 },
      { driverId: "C", earningsScore: 5, tripsThisMonth: 1, tieBreaker: 2 },
    ]);
    expect(ranked).toEqual(["C", "B", "A"]);
  });
});

describe("pickNextOnCallDriver", () => {
  const today = new Date("2026-06-10T00:00:00");

  it("picks the driver who hasn't been on-call most recently", () => {
    const result = pickNextOnCallDriver(today, [
      { driverId: "A", lastOnCallAt: new Date("2026-06-09"), joinedAt: new Date("2026-01-01") },
      { driverId: "B", lastOnCallAt: new Date("2026-06-02"), joinedAt: new Date("2026-01-01") },
      { driverId: "C", lastOnCallAt: null, joinedAt: new Date("2026-01-01") },
    ]);
    // C has never been on-call → freshest, picked first.
    expect(result).toBe("C");
  });

  it("falls back to overall least-recent when everyone is fresh", () => {
    const result = pickNextOnCallDriver(today, [
      { driverId: "A", lastOnCallAt: new Date("2026-05-01"), joinedAt: new Date("2026-01-01") },
      { driverId: "B", lastOnCallAt: new Date("2026-05-15"), joinedAt: new Date("2026-01-01") },
    ]);
    expect(result).toBe("A");
  });

  it("returns null with no candidates", () => {
    expect(pickNextOnCallDriver(today, [])).toBeNull();
  });
});
