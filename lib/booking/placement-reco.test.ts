import { describe, it, expect } from "vitest";
import { recommendPlacement, type RecoDriver } from "./placement-reco";

const D = (s: string) => new Date(s);
const drv = (id: string, o: Partial<RecoDriver> = {}): RecoDriver => ({
  driverId: id,
  vehicleId: `v${id}`,
  registrationNumber: `R${id}`,
  driverName: id,
  earningsScore: 0,
  lastAssignedAt: null,
  trips: [],
  ...o,
});

describe("recommendPlacement", () => {
  const booking = { startAt: D("2026-06-10T13:00:00"), endAt: D("2026-06-10T15:00:00") };
  const overlap = [{ startAt: D("2026-06-10T13:00:00"), endAt: D("2026-06-10T15:00:00") }];
  const base = { booking, needsSecondary: false as boolean, dutyDriverId: null as string | null };

  it("picks the fairest free non-duty car", () => {
    const r = recommendPlacement({
      ...base,
      dutyDriverId: "A",
      drivers: [drv("A", { earningsScore: 0 }), drv("B", { earningsScore: 5 }), drv("C", { earningsScore: 2 })],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "C", vehicleId: "vC", secondaryDriverId: null });
  });

  it("excludes a driver whose trip overlaps the booking", () => {
    const r = recommendPlacement({
      ...base,
      drivers: [drv("B", { earningsScore: 0, trips: overlap }), drv("C", { earningsScore: 9 })],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "C" });
  });

  it("ignores the 2-job cap — a driver with 2 non-overlapping trips is still recommendable", () => {
    const r = recommendPlacement({
      ...base,
      drivers: [
        drv("B", {
          trips: [
            { startAt: D("2026-06-10T06:00:00"), endAt: D("2026-06-10T08:00:00") },
            { startAt: D("2026-06-10T09:00:00"), endAt: D("2026-06-10T11:00:00") },
          ],
        }),
      ],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "B" });
  });

  it("falls back to the duty car (reclaim) when no non-duty car is free", () => {
    const r = recommendPlacement({ ...base, dutyDriverId: "A", drivers: [drv("A"), drv("B", { trips: overlap })] });
    expect(r).toMatchObject({ kind: "reclaim", driverId: "A", vehicleId: "vA" });
  });

  it("none when nobody is free and there's no duty car", () => {
    const r = recommendPlacement({ ...base, drivers: [drv("B", { trips: overlap })] });
    expect(r).toEqual({ kind: "none" });
  });

  it("skips an unpaired driver (no car)", () => {
    const r = recommendPlacement({ ...base, drivers: [drv("B", { vehicleId: null })] });
    expect(r).toEqual({ kind: "none" });
  });

  it("recommends a co-driver (next-fairest free) for a >400 km trip", () => {
    const r = recommendPlacement({
      ...base,
      needsSecondary: true,
      drivers: [drv("B", { earningsScore: 1 }), drv("C", { earningsScore: 2 }), drv("D", { earningsScore: 3 })],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "B", secondaryDriverId: "C" });
  });

  it("co-driver is null when only one driver is free", () => {
    const r = recommendPlacement({
      ...base,
      needsSecondary: true,
      drivers: [drv("B"), drv("C", { trips: overlap })],
    });
    expect(r).toMatchObject({ kind: "fit", driverId: "B", secondaryDriverId: null });
  });
});
