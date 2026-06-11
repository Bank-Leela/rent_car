import { describe, it, expect } from "vitest";
import { recommendOvertimePlacement, type OvertimeRecoDriver } from "./overtime-reco";
import type { SlotInput } from "./slot-allocation";

const D = (s: string) => new Date(s);
const day = D("2026-06-10T00:00:00");
const vehicles: SlotInput[] = [
  { vehicleId: "v1", registrationNumber: "A1", isDutyVehicle: false },
  { vehicleId: "v2", registrationNumber: "A2", isDutyVehicle: false },
];

function driver(driverId: string, over: Partial<OvertimeRecoDriver> = {}): OvertimeRecoDriver {
  return { driverId, earningsScore: 0, lastAssignedAt: null, trips: [], ...over };
}

describe("recommendOvertimePlacement", () => {
  it("evening OT, all free → fairest NON-duty driver + first free car", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T20:00:00"), endAt: D("2026-06-10T21:00:00") },
      dutyDriverId: "A", // A is duty (earnings 0, would win) → must be excluded
      drivers: [driver("A", { earningsScore: 0 }), driver("B", { earningsScore: 5 }), driver("C", { earningsScore: 2 })],
      vehicles,
      vehicleTrips: [],
      day,
    });
    expect(r).toEqual({ kind: "overtime-fit", driverId: "C", vehicleId: "v1" });
  });

  it("early-morning OT → overtime-fit", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T05:00:00"), endAt: D("2026-06-10T07:00:00") },
      dutyDriverId: null,
      drivers: [driver("B")],
      vehicles,
      vehicleTrips: [],
      day,
    });
    expect(r.kind).toBe("overtime-fit");
  });

  it("the 2-job/day cap does NOT block: a driver who did a full 08:00–16:00 day is still recommended for a 20:00 OT", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T20:00:00"), endAt: D("2026-06-10T21:00:00") },
      dutyDriverId: null,
      drivers: [driver("B", { trips: [{ startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-10T16:00:00") }] })],
      vehicles,
      vehicleTrips: [],
      day,
    });
    expect(r).toEqual({ kind: "overtime-fit", driverId: "B", vehicleId: "v1" });
  });

  it("a within-window booking is not-applicable (not overtime)", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T10:00:00"), endAt: D("2026-06-10T12:00:00") },
      dutyDriverId: null,
      drivers: [driver("B")],
      vehicles,
      vehicleTrips: [],
      day,
    });
    expect(r).toEqual({ kind: "not-applicable" });
  });

  it("no free driver (all non-duty drivers overlap the evening) → no-fit", () => {
    const evening = { startAt: D("2026-06-10T19:00:00"), endAt: D("2026-06-10T22:00:00") };
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T20:00:00"), endAt: D("2026-06-10T21:00:00") },
      dutyDriverId: "A",
      drivers: [driver("B", { trips: [evening] }), driver("C", { trips: [evening] })],
      vehicles,
      vehicleTrips: [],
      day,
    });
    expect(r).toEqual({ kind: "no-fit" });
  });

  it("driver free but no vehicle free in the bucket → no-fit", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T20:00:00"), endAt: D("2026-06-10T21:00:00") },
      dutyDriverId: null,
      drivers: [driver("B")],
      vehicles,
      // both cars already out on an overlapping evening trip
      vehicleTrips: [
        { vehicleId: "v1", startAt: D("2026-06-10T18:00:00"), endAt: D("2026-06-10T23:00:00") },
        { vehicleId: "v2", startAt: D("2026-06-10T18:00:00"), endAt: D("2026-06-10T23:00:00") },
      ],
      day,
    });
    expect(r).toEqual({ kind: "no-fit" });
  });
});
