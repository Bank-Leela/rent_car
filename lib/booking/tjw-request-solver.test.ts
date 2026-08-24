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

  it("excludes the duty driver on a MIDDLE spanned day, not only the first", () => {
    // 3-day span 07-10 → 07-12; duty falls on the MIDDLE day (07-11) only.
    const midMs = D("2026-07-11T00:00").getTime();
    const out = solveTjwByRequest(
      base({
        drivers: [drv("A")],
        driverCar: new Map([["A", "carA"]]),
        dutyByDay: new Map([[midMs, "A"]]),
        requests: [req("r1", "2026-06-25", "2026-07-10T08:00", "2026-07-12T18:00")],
      }),
    );
    expect(out.overflows).toEqual([{ bookingId: "r1", reason: "NO_PRIMARY_DRIVER" }]);
  });

  it("needsSecondaryDriver flag pairs a co-driver even with null distance", () => {
    const out = solveTjwByRequest(
      base({
        requests: [
          {
            bookingId: "flag",
            createdAt: D("2026-06-25"),
            startAt: D("2026-07-10T08:00"),
            endAt: D("2026-07-12T18:00"),
            estimatedDistance: null,
            needsSecondaryDriver: true,
          },
        ],
      }),
    );
    expect(out.assignments[0]?.primaryDriverId).toBe("A");
    expect(out.assignments[0]?.secondaryDriverId).toBe("B");
  });

  it(">400km consumes primary + co-driver, so a later overlapping TJW overflows", () => {
    const out = solveTjwByRequest(
      base({
        requests: [
          req("long", "2026-06-25", "2026-07-10T08:00", "2026-07-12T18:00", 700), // takes A + B
          req("next", "2026-06-26", "2026-07-11T08:00", "2026-07-11T18:00", 100), // overlaps long's span
        ],
      }),
    );
    const longA = out.assignments.find((a) => a.bookingId === "long");
    expect(longA?.primaryDriverId).toBe("A");
    expect(longA?.secondaryDriverId).toBe("B");
    expect(out.overflows).toContainEqual({ bookingId: "next", reason: "NO_PRIMARY_DRIVER" });
  });

  it("applies the §4 2h gap, like every other engine", () => {
    // This file used to ask a private `overlaps()` — bare interval non-overlap,
    // i.e. a ZERO gap — while §4 requires 120 minutes for every job type. The
    // same booking through จับคู่อัตโนมัติ refused this driver.
    const day = (h: number, d = 1) => new Date(2026, 8, d, h, 0, 0, 0);
    const out = solveTjwByRequest({
      requests: [{ bookingId: "b1", startAt: day(11), endAt: day(18, 3), createdAt: day(1), estimatedDistance: null, needsSecondaryDriver: false }],
      drivers: [{ driverId: "A", lastTjwAt: null, lastOtAt: null, lastDutyAt: null, earningsScore: 0, lastAssignedAt: null }],
      driverCar: new Map([["A", "car-a"]]),
      dutyByDay: new Map(),
      // A real trip ending 10:00 — one hour before the TJW departs.
      existingCommitments: [{ driverId: "A", startAt: day(8), endAt: day(10), kind: "trip" }],
    } as never) as { assignments: unknown[]; overflows: { reason: string }[] };

    expect(out.assignments, "a 60-minute turnaround must not be dispatched").toHaveLength(0);
    expect(out.overflows[0]?.reason).toBe("NO_PRIMARY_DRIVER");
  });

  it("does not extend a whole-day leave block by the gap", () => {
    // Leave arrives as a synthetic 00:00–24:00 span. Applying the 2h gap to it
    // would block two hours of the neighbouring days as well, quietly turning
    // one day off into one and a bit.
    const day = (h: number, d = 1) => new Date(2026, 8, d, h, 0, 0, 0);
    const out = solveTjwByRequest({
      requests: [{ bookingId: "b1", startAt: day(6, 2), endAt: day(18, 4), createdAt: day(1), estimatedDistance: null, needsSecondaryDriver: false }],
      drivers: [{ driverId: "A", lastTjwAt: null, lastOtAt: null, lastDutyAt: null, earningsScore: 0, lastAssignedAt: null }],
      driverCar: new Map([["A", "car-a"]]),
      dutyByDay: new Map(),
      // Off on the 1st. The trip starts 06:00 on the 2nd — inside the gap, but
      // the block is a whole day, so only real overlap should count.
      existingCommitments: [{ driverId: "A", startAt: day(0, 1), endAt: day(0, 2), kind: "block" }],
    } as never) as { assignments: { primaryDriverId: string }[] };

    expect(out.assignments[0]?.primaryDriverId, "leave must not bleed into the next day").toBe("A");
  });
});
