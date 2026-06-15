import { describe, it, expect } from "vitest";
import { recommendOvertimePlacement, type OvertimeRecoDriver } from "./overtime-reco";

const D = (s: string) => new Date(s);

// car=driver: each driver carries their assigned car (vehicleId "v<id>").
function driver(driverId: string, over: Partial<OvertimeRecoDriver> = {}): OvertimeRecoDriver {
  return { driverId, vehicleId: `v${driverId}`, earningsScore: 0, lastAssignedAt: null, trips: [], ...over };
}

describe("recommendOvertimePlacement", () => {
  it("evening OT, all free → fairest NON-duty driver + their own car", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T20:00:00"), endAt: D("2026-06-10T21:00:00") },
      dutyDriverId: "A", // A is duty (earnings 0, would win) → must be excluded
      drivers: [driver("A", { earningsScore: 0 }), driver("B", { earningsScore: 5 }), driver("C", { earningsScore: 2 })],
    });
    expect(r).toEqual({ kind: "overtime-fit", driverId: "C", vehicleId: "vC" });
  });

  it("early-morning OT → overtime-fit", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T05:00:00"), endAt: D("2026-06-10T07:00:00") },
      dutyDriverId: null,
      drivers: [driver("B")],
    });
    expect(r.kind).toBe("overtime-fit");
  });

  it("the 2-job/day cap does NOT block: a driver who did a full 08:00–16:00 day is still recommended for a 20:00 OT", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T20:00:00"), endAt: D("2026-06-10T21:00:00") },
      dutyDriverId: null,
      drivers: [driver("B", { trips: [{ startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-10T16:00:00") }] })],
    });
    expect(r).toEqual({ kind: "overtime-fit", driverId: "B", vehicleId: "vB" });
  });

  it("a within-window booking is not-applicable (not overtime)", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T10:00:00"), endAt: D("2026-06-10T12:00:00") },
      dutyDriverId: null,
      drivers: [driver("B")],
    });
    expect(r).toEqual({ kind: "not-applicable" });
  });

  it("no free driver (all non-duty drivers overlap the evening) → no-fit", () => {
    const evening = { startAt: D("2026-06-10T19:00:00"), endAt: D("2026-06-10T22:00:00") };
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T20:00:00"), endAt: D("2026-06-10T21:00:00") },
      dutyDriverId: "A",
      drivers: [driver("B", { trips: [evening] }), driver("C", { trips: [evening] })],
    });
    expect(r).toEqual({ kind: "no-fit" });
  });

  it("a free driver with no assigned car (unpaired) → no-fit", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T20:00:00"), endAt: D("2026-06-10T21:00:00") },
      dutyDriverId: null,
      drivers: [driver("B", { vehicleId: null })],
    });
    expect(r).toEqual({ kind: "no-fit" });
  });
});
