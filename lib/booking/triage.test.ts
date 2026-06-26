import { describe, expect, it } from "vitest";
import { addDays, addHours, setHours, startOfDay } from "date-fns";
import { BANGKOK_PROVINCE } from "./rules";
import { triageFlags, waitingHours, SLA_WARN_HOURS, type TriageFlag } from "./triage";

const NOW = new Date("2026-06-15T09:00:00");

// A request with safe defaults: in-hours, far enough out, in Bangkok, not full,
// no cancellations. Override one field per test to isolate a single flag.
function base(over: Partial<Parameters<typeof triageFlags>[0]> = {}) {
  const start = setHours(addDays(NOW, 30), 9); // 30d out, 09:00
  const end = setHours(addDays(NOW, 30), 11); // 11:00 same day
  return triageFlags({
    startAt: start,
    endAt: end,
    province: BANGKOK_PROVINCE,
    isEmergency: false,
    now: NOW,
    dayUsed: 0,
    dayCapacity: 11,
    cancellations: 0,
    ...over,
  });
}

const keys = (flags: TriageFlag[]) => flags.map((f) => f.key).sort();

describe("triageFlags", () => {
  it("a clean far-future Bangkok request raises no flags", () => {
    expect(base()).toEqual([]);
  });

  it("flags an emergency", () => {
    expect(keys(base({ isEmergency: true }))).toContain("emergency");
  });

  it("flags out-of-hours when the trip runs past work hours", () => {
    const start = setHours(addDays(NOW, 30), 17);
    const end = setHours(addDays(NOW, 30), 19); // ends 19:00 > 18:00
    expect(keys(base({ startAt: start, endAt: end }))).toContain("outOfHours");
  });

  it("flags out-of-hours for an overnight trip", () => {
    const start = setHours(addDays(NOW, 30), 9);
    const end = setHours(addDays(NOW, 31), 9); // next day
    expect(keys(base({ startAt: start, endAt: end }))).toContain("outOfHours");
  });

  it("flags short lead time when sooner than the Bangkok minimum", () => {
    const start = setHours(addDays(NOW, 2), 9); // 2d < 7d Bangkok minimum
    const end = setHours(addDays(NOW, 2), 11);
    expect(keys(base({ startAt: start, endAt: end }))).toContain("shortLead");
  });

  it("flags day-full and carries the used/capacity counts", () => {
    const flags = base({ dayUsed: 11, dayCapacity: 11 });
    const full = flags.find((f) => f.key === "dayFull");
    expect(full).toEqual({ key: "dayFull", used: 11, capacity: 11 });
  });

  it("does not flag day-full below capacity", () => {
    expect(keys(base({ dayUsed: 10, dayCapacity: 11 }))).not.toContain("dayFull");
  });

  it("flags a repeat canceller at 3+ in 90 days", () => {
    const flags = base({ cancellations: 3 });
    expect(flags.find((f) => f.key === "repeatCanceller")).toEqual({
      key: "repeatCanceller",
      count: 3,
    });
    expect(keys(base({ cancellations: 2 }))).not.toContain("repeatCanceller");
  });

  it("stacks multiple flags", () => {
    const start = setHours(addDays(NOW, 1), 17);
    const end = setHours(addDays(NOW, 1), 20);
    expect(keys(base({ startAt: start, endAt: end, isEmergency: true }))).toEqual([
      "emergency",
      "outOfHours",
      "shortLead",
    ]);
  });
});

describe("waitingHours", () => {
  it("counts whole hours since submission", () => {
    expect(waitingHours(addHours(NOW, -SLA_WARN_HOURS), NOW)).toBe(SLA_WARN_HOURS);
  });

  it("never goes negative for a future timestamp", () => {
    expect(waitingHours(addHours(NOW, 5), NOW)).toBe(0);
  });

  it("rounds the same-day case to 0", () => {
    expect(waitingHours(startOfDay(NOW), startOfDay(NOW))).toBe(0);
  });
});
