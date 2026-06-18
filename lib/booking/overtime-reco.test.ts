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

  it("respects the 2h gap: an OT 1h after a day-job is NOT recommended; 2h is", () => {
    const dayJob = { startAt: D("2026-06-10T14:00:00"), endAt: D("2026-06-10T16:00:00") };
    const tooSoon = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T17:00:00"), endAt: D("2026-06-10T19:00:00") }, // 1h after 16:00
      dutyDriverId: null,
      drivers: [driver("B", { trips: [dayJob] })],
    });
    expect(tooSoon).toEqual({ kind: "no-fit" });
    const okGap = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T18:00:00"), endAt: D("2026-06-10T20:00:00") }, // 2h after 16:00
      dutyDriverId: null,
      drivers: [driver("B", { trips: [dayJob] })],
    });
    expect(okGap).toEqual({ kind: "overtime-fit", driverId: "B", vehicleId: "vB" });
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

describe("recommendOvertimePlacement — overnight + boundaries", () => {
  it("overnight OT (crosses midnight) is recommended, not skipped as not-applicable", () => {
    // Regression: isOvertimeWindow was hour-only, so 22:00→02:00 read as
    // "ends 02:00 ≤ 16:00" → not-applicable. An overnight trip is OT.
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T22:00:00"), endAt: D("2026-06-11T02:00:00") },
      dutyDriverId: null,
      drivers: [driver("B")],
    });
    expect(r).toEqual({ kind: "overtime-fit", driverId: "B", vehicleId: "vB" });
  });

  it("other overnight shapes are recognised too (14:00→next 10:00, 17:00→next 00:30)", () => {
    for (const [s, e] of [
      ["2026-06-10T14:00:00", "2026-06-11T10:00:00"],
      ["2026-06-10T17:00:00", "2026-06-11T00:30:00"],
    ] as const) {
      const r = recommendOvertimePlacement({
        booking: { startAt: D(s), endAt: D(e) },
        dutyDriverId: null,
        drivers: [driver("B")],
      });
      expect(r.kind).toBe("overtime-fit");
    }
  });

  it("a same-day trip ending exactly 16:00 is NOT overtime → not-applicable", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T12:00:00"), endAt: D("2026-06-10T16:00:00") },
      dutyDriverId: null,
      drivers: [driver("B")],
    });
    expect(r).toEqual({ kind: "not-applicable" });
  });

  it("ending 16:01 and starting 07:59 are overtime; an 08:00–10:00 in-window trip is not", () => {
    expect(
      recommendOvertimePlacement({
        booking: { startAt: D("2026-06-10T12:00:00"), endAt: D("2026-06-10T16:01:00") },
        dutyDriverId: null,
        drivers: [driver("B")],
      }).kind,
    ).toBe("overtime-fit");
    expect(
      recommendOvertimePlacement({
        booking: { startAt: D("2026-06-10T07:59:00"), endAt: D("2026-06-10T09:00:00") },
        dutyDriverId: null,
        drivers: [driver("B")],
      }).kind,
    ).toBe("overtime-fit");
    expect(
      recommendOvertimePlacement({
        booking: { startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-10T10:00:00") },
        dutyDriverId: null,
        drivers: [driver("B")],
      }).kind,
    ).toBe("not-applicable");
  });

  it("an all-duty pool and an empty pool both yield no-fit", () => {
    const evening = { startAt: D("2026-06-10T20:00:00"), endAt: D("2026-06-10T21:00:00") };
    expect(recommendOvertimePlacement({ booking: evening, dutyDriverId: null, drivers: [] })).toEqual({ kind: "no-fit" });
    expect(recommendOvertimePlacement({ booking: evening, dutyDriverId: "A", drivers: [driver("A")] })).toEqual({ kind: "no-fit" });
  });

  it("breaks a full fairness tie by driverId", () => {
    const r = recommendOvertimePlacement({
      booking: { startAt: D("2026-06-10T20:00:00"), endAt: D("2026-06-10T21:00:00") },
      dutyDriverId: null,
      drivers: [driver("Z"), driver("A")],
    });
    expect(r).toMatchObject({ driverId: "A" });
  });
});
