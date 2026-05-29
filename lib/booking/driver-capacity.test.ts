import { describe, expect, it } from "vitest";
import {
  buildDriverMatrix,
  canTakeTrip,
  filterAvailable,
  rankCandidates,
  type DriverAvailabilityInput,
  type DriverInput,
} from "./driver-capacity";

describe("buildDriverMatrix", () => {
  const drivers: DriverInput[] = [
    { driverId: "A", joinedAt: new Date("2026-01-01"), lastAssignedAt: null },
    { driverId: "B", joinedAt: new Date("2026-01-01"), lastAssignedAt: null },
  ];

  it("emits one column per JobType (CR-06: 4 categories)", () => {
    const m = buildDriverMatrix(drivers, []);
    expect(m[0]!.map((c) => c.jobType)).toEqual([
      "TJW",
      "OT",
      "WERN",
      "NORMAL",
    ]);
  });

  it("marks the matching cell busy when the driver has a trip of that JobType", () => {
    const m = buildDriverMatrix(drivers, [{ driverId: "A", jobType: "OT" }]);
    const rowA = m.find((r) => r[0]!.driverId === "A")!;
    expect(rowA.find((c) => c.jobType === "OT")!.busy).toBe(true);
    expect(rowA.find((c) => c.jobType === "NORMAL")!.busy).toBe(false);
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

  it("allows afternoon after a morning trip with 2 h gap", () => {
    expect(canTakeTrip(afternoonOk, [morning])).toBe(true);
  });

  it("rejects afternoon when 2 h gap isn't met", () => {
    expect(canTakeTrip(afternoonTooSoon, [morning])).toBe(false);
  });

  it("rejects a third trip on the same day", () => {
    expect(canTakeTrip(afternoonOk, [morning, afternoonOk])).toBe(false);
  });

  it("rejects an overlap", () => {
    const overlap = {
      startAt: new Date("2026-06-10T10:00:00"),
      endAt: new Date("2026-06-10T12:00:00"),
    };
    expect(canTakeTrip(overlap, [morning])).toBe(false);
  });

  it("symmetric: an afternoon-first booking can still pick up an earlier morning the same day with gap", () => {
    const earlyMorning = {
      startAt: new Date("2026-06-10T06:00:00"),
      endAt: new Date("2026-06-10T08:00:00"),
    };
    expect(canTakeTrip(earlyMorning, [afternoonOk])).toBe(true);
  });

  it("blocks if the only existing trip already spans morning + afternoon", () => {
    const wideTrip = {
      startAt: new Date("2026-06-10T09:00:00"),
      endAt: new Date("2026-06-10T15:00:00"),
    };
    const afternoon = {
      startAt: new Date("2026-06-10T17:30:00"),
      endAt: new Date("2026-06-10T19:00:00"),
    };
    expect(canTakeTrip(afternoon, [wideTrip])).toBe(false);
  });
});

describe("filterAvailable", () => {
  it("keeps drivers whose existing trips leave room for the new one", () => {
    const newTrip = {
      startAt: new Date("2026-06-10T14:00:00"),
      endAt: new Date("2026-06-10T16:00:00"),
    };
    const input: DriverAvailabilityInput[] = [
      { driverId: "A", existing: [] },
      {
        driverId: "B",
        existing: [
          { startAt: new Date("2026-06-10T08:00:00"), endAt: new Date("2026-06-10T11:00:00") },
        ],
      },
      {
        driverId: "C",
        existing: [
          { startAt: new Date("2026-06-10T13:00:00"), endAt: new Date("2026-06-10T15:00:00") },
        ],
      },
    ];
    expect(filterAvailable(newTrip, input)).toEqual(["A", "B"]);
  });
});

describe("rankCandidates", () => {
  it("orders by earnings ascending, ties broken by trips then lastAssignedAt", () => {
    const r = rankCandidates([
      { driverId: "A", earningsScore: 5, tripsThisMonth: 1, lastAssignedAt: new Date("2026-05-10") },
      { driverId: "B", earningsScore: 5, tripsThisMonth: 1, lastAssignedAt: null },
      { driverId: "C", earningsScore: 3, tripsThisMonth: 0, lastAssignedAt: null },
    ]);
    expect(r).toEqual(["C", "B", "A"]);
  });
});
