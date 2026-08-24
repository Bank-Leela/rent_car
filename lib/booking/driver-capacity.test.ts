import { describe, expect, it } from "vitest";
import { pickGeneralRank } from "@/lib/booking/rotations";
import {
  buildDriverMatrix,
  canTakeTrip,
  filterAvailable,
  pickFreeDriver,
  rankCandidates,
  type DriverAvailabilityInput,
  type DriverInput,
  type FreeDriverInput,
} from "./driver-capacity";

const PD = (s: string) => new Date(s);
function fd(driverId: string, over: Partial<FreeDriverInput> = {}): FreeDriverInput {
  return { driverId, earningsScore: 0, lastAssignedAt: null, trips: [], ...over };
}

describe("pickFreeDriver", () => {
  const trip = { startAt: PD("2026-06-10T14:00:00"), endAt: PD("2026-06-10T16:00:00") };

  it("picks the fairest (lowest earnings) free driver", () => {
    expect(
      pickFreeDriver(trip, [fd("A", { earningsScore: 5 }), fd("B", { earningsScore: 2 }), fd("C", { earningsScore: 9 })], null),
    ).toBe("B");
  });

  it("excludes the on-call (duty) driver even when fairest", () => {
    expect(pickFreeDriver(trip, [fd("A", { earningsScore: 0 }), fd("B", { earningsScore: 3 })], "A")).toBe("B");
  });

  it("skips a driver with an overlapping trip", () => {
    const busy = { startAt: PD("2026-06-10T15:00:00"), endAt: PD("2026-06-10T18:00:00") };
    expect(pickFreeDriver(trip, [fd("A", { earningsScore: 0, trips: [busy] }), fd("B", { earningsScore: 9 })], null)).toBe("B");
  });

  it("skips a driver already at the 2-job cap", () => {
    const two = [
      { startAt: PD("2026-06-10T08:00:00"), endAt: PD("2026-06-10T10:00:00") },
      { startAt: PD("2026-06-10T11:00:00"), endAt: PD("2026-06-10T12:00:00") },
    ];
    expect(pickFreeDriver(trip, [fd("A", { earningsScore: 0, trips: two }), fd("B", { earningsScore: 9 })], null)).toBe("B");
  });

  it("returns null when no driver is free", () => {
    const busy = { startAt: PD("2026-06-10T13:00:00"), endAt: PD("2026-06-10T17:00:00") };
    expect(pickFreeDriver(trip, [fd("A", { trips: [busy] }), fd("B", { trips: [busy] })], null)).toBeNull();
  });
});

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

  it("a trip ending after noon (12:30) is not 'morning' — blocks a second trip", () => {
    const midday = {
      startAt: new Date("2026-06-10T10:00:00"),
      endAt: new Date("2026-06-10T12:30:00"),
    };
    const later = {
      startAt: new Date("2026-06-10T15:00:00"),
      endAt: new Date("2026-06-10T17:00:00"),
    };
    expect(canTakeTrip(later, [midday])).toBe(false);
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

  it("breaks a full fairness tie by driverId (so DB row order can't decide which car wins)", () => {
    const tie = [
      { driverId: "Z", earningsScore: 0, tripsThisMonth: 0, lastAssignedAt: null },
      { driverId: "A", earningsScore: 0, tripsThisMonth: 0, lastAssignedAt: null },
      { driverId: "M", earningsScore: 0, tripsThisMonth: 0, lastAssignedAt: null },
    ];
    expect(rankCandidates(tie)).toEqual(["A", "M", "Z"]);
    expect(rankCandidates([...tie].reverse())).toEqual(["A", "M", "Z"]); // order-independent
  });

  it("ranks identically to the solver — tripsThisMonth does not order anybody", () => {
    // Settled 2026-08-24. The matcher used to break an earnings tie on
    // tripsThisMonth while the solver broke it on lastAssignedAt, so the two
    // engines named different drivers for the same booking — and §6a of the
    // scheduling doc specified the divergence while §3 specified the ledger.
    // A ranks first: both have a null lastAssignedAt and "A" < "B"; the higher
    // tripsThisMonth is ignored.
    expect(
      rankCandidates([
        { driverId: "A", earningsScore: 5, tripsThisMonth: 3, lastAssignedAt: null },
        { driverId: "B", earningsScore: 5, tripsThisMonth: 1, lastAssignedAt: null },
      ]),
    ).toEqual(["A", "B"]);
  });

  it("agrees with the solver's own ranker on the same input", () => {
    // The regression that matters is not "what order is it" but "is it the SAME
    // order the other engine produces". Nothing compared them before.
    const rows = [
      { driverId: "x", earningsScore: 5, tripsThisMonth: 9, lastAssignedAt: new Date(2026, 0, 3) },
      { driverId: "y", earningsScore: 5, tripsThisMonth: 0, lastAssignedAt: new Date(2026, 0, 1) },
      { driverId: "z", earningsScore: 2, tripsThisMonth: 4, lastAssignedAt: null },
    ];
    const solverOrder = pickGeneralRank(
      rows.map((r) => ({
        driverId: r.driverId, earningsScore: r.earningsScore, lastAssignedAt: r.lastAssignedAt,
        lastTjwAt: null, lastOtAt: null, lastDutyAt: null,
      })),
    );
    expect(rankCandidates(rows)).toEqual(solverOrder);
  });

  it("does not mutate its input array", () => {
    const rows = [
      { driverId: "B", earningsScore: 5, tripsThisMonth: 0, lastAssignedAt: null },
      { driverId: "A", earningsScore: 1, tripsThisMonth: 0, lastAssignedAt: null },
    ];
    const before = rows.map((r) => r.driverId);
    rankCandidates(rows);
    expect(rows.map((r) => r.driverId)).toEqual(before);
  });
});

describe("pickFreeDriver — duty + empty pool", () => {
  const trip = { startAt: new Date("2026-06-10T14:00:00"), endAt: new Date("2026-06-10T16:00:00") };

  it("returns null when the only otherwise-free driver is the excluded duty driver", () => {
    const busy = { startAt: new Date("2026-06-10T13:00:00"), endAt: new Date("2026-06-10T17:00:00") };
    expect(pickFreeDriver(trip, [fd("A"), fd("B", { trips: [busy] })], "A")).toBeNull();
  });

  it("returns null for an empty pool", () => {
    expect(pickFreeDriver(trip, [], null)).toBeNull();
  });

  it("breaks a full fairness tie by driverId", () => {
    expect(pickFreeDriver(trip, [fd("Z"), fd("A")], null)).toBe("A");
  });
});
