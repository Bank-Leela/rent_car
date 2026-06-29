import { describe, expect, it } from "vitest";
import { generateRandomDemoBookings } from "./sim-generator";

const START = new Date("2026-08-01T00:00:00");

describe("generateRandomDemoBookings", () => {
  it("is deterministic by seed", () => {
    const a = generateRandomDemoBookings(START, 30, 123);
    const b = generateRandomDemoBookings(START, 30, 123);
    const c = generateRandomDemoBookings(START, 30, 124);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    expect(a.length).toBeGreaterThan(30); // multiple bookings per day over a month
  });

  it("ตจว are overnight + out-of-province", () => {
    const tjw = generateRandomDemoBookings(START, 30, 7).filter((b) => b.jobType === "TJW");
    expect(tjw.length).toBeGreaterThan(0);
    for (const t of tjw) {
      expect(t.outOfProvince).toBe(true);
      expect(t.startAt.toDateString()).not.toBe(t.endAt.toDateString()); // overnight
      expect(t.waitAtDestination).toBe(true); // never no-wait
    }
  });

  it("no-wait trips have a valid same-day leg split", () => {
    const noWait = generateRandomDemoBookings(START, 30, 7).filter((b) => !b.waitAtDestination);
    expect(noWait.length).toBeGreaterThan(0);
    for (const n of noWait) {
      expect(n.dropOffDone).not.toBeNull();
      expect(n.pickupReturnTime).toMatch(/^\d\d:\d\d$/);
      const [h, m] = n.pickupReturnTime!.split(":").map(Number);
      const ret = new Date(n.startAt);
      ret.setHours(h, m, 0, 0);
      // start < dropOffDone < pickupReturn < end, all same calendar day
      expect(n.startAt.getTime()).toBeLessThan(n.dropOffDone!.getTime());
      expect(n.dropOffDone!.getTime()).toBeLessThan(ret.getTime());
      expect(ret.getTime()).toBeLessThan(n.endAt.getTime());
      expect(n.startAt.toDateString()).toBe(n.endAt.toDateString());
    }
  });

  it("non-ตจว trips are same-day and every request precedes its trip", () => {
    const all = generateRandomDemoBookings(START, 30, 99);
    for (const b of all) {
      if (b.jobType !== "TJW") expect(b.startAt.toDateString()).toBe(b.endAt.toDateString());
      expect(b.createdAt.getTime()).toBeLessThan(b.startAt.getTime());
    }
  });
});
