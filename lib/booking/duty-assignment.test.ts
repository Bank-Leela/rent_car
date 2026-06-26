import { describe, expect, it } from "vitest";
import { resolveWernDriver, pickAutoDutyDriver, type DutyCandidate } from "@/lib/booking/duty-assignment";

const d = (id: string, lastDutyAt: Date | null): DutyCandidate => ({ driverId: id, lastDutyAt });
const allCars = () => true;

describe("resolveWernDriver", () => {
  const candidates = [d("a", new Date("2026-01-01")), d("b", new Date("2026-02-01")), d("c", null)];

  it("uses the on-call driver when present and car-paired", () => {
    expect(resolveWernDriver({ onCallDriverId: "b", awayDriverIds: new Set(), hasCar: allCars, candidates })).toBe("b");
  });

  it("falls back to the oldest-duty present driver when the on-call driver is away", () => {
    // on-call 'b' away → fall back; 'c' (null lastDutyAt = oldest) wins.
    expect(resolveWernDriver({ onCallDriverId: "b", awayDriverIds: new Set(["b"]), hasCar: allCars, candidates })).toBe("c");
  });

  it("skips away drivers in the fallback too", () => {
    // 'b' on-call away, 'c' also away → fall back to 'a'.
    expect(resolveWernDriver({ onCallDriverId: "b", awayDriverIds: new Set(["b", "c"]), hasCar: allCars, candidates })).toBe("a");
  });

  it("falls back when no duty driver is rostered", () => {
    expect(resolveWernDriver({ onCallDriverId: null, awayDriverIds: new Set(), hasCar: allCars, candidates })).toBe("c");
  });

  it("skips an unpaired on-call driver and falls back to a car-paired one", () => {
    expect(resolveWernDriver({ onCallDriverId: "b", awayDriverIds: new Set(), hasCar: (id) => id !== "b", candidates })).toBe("c");
  });

  it("returns null when everyone is away", () => {
    expect(resolveWernDriver({ onCallDriverId: "a", awayDriverIds: new Set(["a", "b", "c"]), hasCar: allCars, candidates })).toBeNull();
  });
});

describe("pickAutoDutyDriver", () => {
  const cands = [
    { driverId: "a", lastOnCallAt: new Date("2026-02-01") },
    { driverId: "b", lastOnCallAt: null }, // never on duty → most overdue
    { driverId: "c", lastOnCallAt: new Date("2026-01-01") },
  ];

  it("picks the most-overdue (oldest last on-call) driver", () => {
    expect(pickAutoDutyDriver(cands, new Set())).toBe("b");
  });

  it("excludes a driver away on a TJW even if they're the most overdue", () => {
    // 'b' (most overdue) away → next-oldest 'c'.
    expect(pickAutoDutyDriver(cands, new Set(["b"]))).toBe("c");
  });

  it("falls back to the full pool when every candidate is away (must still name a duty)", () => {
    expect(pickAutoDutyDriver(cands, new Set(["a", "b", "c"]))).toBe("b");
  });
});
