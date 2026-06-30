import { describe, expect, it } from "vitest";
import { solveTjwByRequest, type TjwSolveInput } from "./tjw-request-solver";
import type { DriverRotationState } from "./rotations";

const D = (s: string) => new Date(s);
const drv = (id: string, o: Partial<DriverRotationState> = {}): DriverRotationState => ({
  driverId: id,
  lastTjwAt: null,
  lastOtAt: null,
  lastDutyAt: null,
  earningsScore: 0,
  lastAssignedAt: null,
  ...o,
});
const req = (bookingId: string, createdAt: string, startAt: string, endAt: string, km: number | null = 100) => ({
  bookingId,
  createdAt: D(createdAt),
  startAt: D(startAt),
  endAt: D(endAt),
  estimatedDistance: km,
});
const base = (over: Partial<TjwSolveInput>): TjwSolveInput => ({
  requests: [],
  drivers: [drv("A"), drv("B")],
  driverCar: new Map([
    ["A", "carA"],
    ["B", "carB"],
  ]),
  existingCommitments: [],
  dutyByDay: new Map(),
  ...over,
});

describe("solveTjwByRequest", () => {
  it("orders by createdAt, not trip date (earlier request wins)", () => {
    const out = solveTjwByRequest(
      base({
        requests: [
          req("late-trip-early-req", "2026-06-25", "2026-07-10T08:00", "2026-07-11T18:00"),
          req("early-trip-late-req", "2026-06-26", "2026-07-02T08:00", "2026-07-03T18:00"),
        ],
      }),
    );
    expect(out.overflows).toHaveLength(0);
    expect(out.assignments[0]!.bookingId).toBe("late-trip-early-req");
  });

  it("rotation bump sends the 2nd request to the next-fairest driver (A then B)", () => {
    const out = solveTjwByRequest(
      base({
        requests: [
          req("r1", "2026-06-25", "2026-07-10T08:00", "2026-07-12T18:00"),
          req("r2", "2026-06-26", "2026-07-10T08:00", "2026-07-12T18:00"),
        ],
      }),
    );
    expect(out.assignments.map((a) => [a.bookingId, a.primaryDriverId])).toEqual([
      ["r1", "A"],
      ["r2", "B"],
    ]);
  });

  it("excludes a driver busy on an overlapping committed span", () => {
    const out = solveTjwByRequest(
      base({
        drivers: [drv("A")],
        driverCar: new Map([["A", "carA"]]),
        existingCommitments: [{ driverId: "A", startAt: D("2026-07-10T00:00"), endAt: D("2026-07-13T00:00") }],
        requests: [req("r1", "2026-06-25", "2026-07-11T08:00", "2026-07-12T18:00")],
      }),
    );
    expect(out.overflows).toEqual([{ bookingId: "r1", reason: "NO_PRIMARY_DRIVER" }]);
  });

  it("excludes the duty driver on a spanned day", () => {
    const dayMs = D("2026-07-10T00:00").getTime();
    const out = solveTjwByRequest(
      base({
        drivers: [drv("A")],
        driverCar: new Map([["A", "carA"]]),
        dutyByDay: new Map([[dayMs, "A"]]),
        requests: [req("r1", "2026-06-25", "2026-07-10T08:00", "2026-07-11T18:00")],
      }),
    );
    expect(out.overflows).toEqual([{ bookingId: "r1", reason: "NO_PRIMARY_DRIVER" }]);
  });

  it("assigns a co-driver for >400km, overflows when none free", () => {
    const ok = solveTjwByRequest(
      base({ requests: [req("long", "2026-06-25", "2026-07-10T08:00", "2026-07-12T18:00", 700)] }),
    );
    expect(ok.assignments[0]!.secondaryDriverId).toBe("B");
    const none = solveTjwByRequest(
      base({
        drivers: [drv("A")],
        driverCar: new Map([["A", "carA"]]),
        requests: [req("long", "2026-06-25", "2026-07-10T08:00", "2026-07-12T18:00", 700)],
      }),
    );
    expect(none.overflows).toEqual([{ bookingId: "long", reason: "NO_SECONDARY_DRIVER" }]);
  });

  it("a driver may take two non-overlapping TJWs", () => {
    const out = solveTjwByRequest(
      base({
        drivers: [drv("A")],
        driverCar: new Map([["A", "carA"]]),
        requests: [
          req("r1", "2026-06-25", "2026-07-02T08:00", "2026-07-03T18:00"),
          req("r2", "2026-06-26", "2026-07-10T08:00", "2026-07-11T18:00"),
        ],
      }),
    );
    expect(out.overflows).toHaveLength(0);
    expect(out.assignments.every((a) => a.primaryDriverId === "A")).toBe(true);
  });
});
