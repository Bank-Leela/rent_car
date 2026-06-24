import { describe, expect, it } from "vitest";
import { solveDay, type SolverInput, type SolverBookingInput } from "./batch-solver";
import type { DriverRotationState } from "./rotations";

const D = (s: string) => new Date(s);

function driver(overrides: Partial<DriverRotationState>): DriverRotationState {
  return {
    driverId: "?",
    lastTjwAt: null,
    lastOtAt: null,
    lastDutyAt: null,
    earningsScore: 0,
    lastAssignedAt: null,
    ...overrides,
  };
}

function booking(overrides: Partial<SolverBookingInput>): SolverBookingInput {
  return {
    bookingId: "b?",
    jobType: "NORMAL",
    startAt: D("2026-06-10T09:00:00"),
    endAt: D("2026-06-10T11:00:00"),
    needsSecondaryDriver: false,
    outOfProvince: false,
    submittedAt: D("2026-06-01T00:00:00"),
    ...overrides,
  };
}

describe("solveDay — phase ordering", () => {
  it("places TJW before NORMAL even when NORMAL was submitted earlier", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({ bookingId: "n1", jobType: "NORMAL", submittedAt: D("2026-06-01T08:00:00") }),
        booking({
          bookingId: "t1",
          jobType: "TJW",
          submittedAt: D("2026-06-02T09:00:00"),
          startAt: D("2026-06-10T08:00:00"),
          endAt: D("2026-06-12T18:00:00"),
          outOfProvince: true,
        }),
      ],
      drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
      dutyDriverId: null,
      activeTjwCommitments: [],
    };
    const out = solveDay(input);
    expect(out.assignments).toHaveLength(2);
    // Default category priority TJW → OT → WERN → NORMAL.
    expect(out.assignments[0]!.bookingId).toBe("t1");
    expect(out.assignments[1]!.bookingId).toBe("n1");
    // Categories used separate drivers.
    expect(new Set(out.assignments.map((a) => a.primaryDriverId)).size).toBe(2);
  });

  it("places OT before WERN before NORMAL", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({ bookingId: "n1", jobType: "NORMAL", submittedAt: D("2026-06-01T08:00:00") }),
        booking({
          bookingId: "w1",
          jobType: "WERN",
          startAt: D("2026-06-10T08:00:00"),
          endAt: D("2026-06-10T16:00:00"),
          submittedAt: D("2026-06-02T09:00:00"),
        }),
        booking({
          bookingId: "o1",
          jobType: "OT",
          startAt: D("2026-06-10T06:00:00"),
          endAt: D("2026-06-10T09:00:00"),
          submittedAt: D("2026-06-03T10:00:00"),
        }),
      ],
      drivers: [
        driver({ driverId: "A" }),
        driver({ driverId: "B" }),
        driver({ driverId: "C" }),
      ],
      dutyDriverId: null,
      activeTjwCommitments: [],
    };
    const out = solveDay(input);
    expect(out.assignments.map((a) => a.bookingId)).toEqual(["o1", "w1", "n1"]);
  });
});

describe("solveDay — duty driver excluded from normal assignments", () => {
  it("never gives duty driver an OT or NORMAL trip", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({ bookingId: "n1", jobType: "NORMAL" }),
      ],
      drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
      dutyDriverId: "A",
      activeTjwCommitments: [],
    };
    const out = solveDay(input);
    expect(out.assignments[0]!.primaryDriverId).toBe("B");
  });
});

describe("solveDay — 2-hour buffer chain", () => {
  it("lets driver chain morning + afternoon with 2h gap", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "m",
          startAt: D("2026-06-10T08:00:00"),
          endAt: D("2026-06-10T11:00:00"),
        }),
        booking({
          bookingId: "a",
          startAt: D("2026-06-10T13:00:00"),
          endAt: D("2026-06-10T16:00:00"),
          submittedAt: D("2026-06-01T08:00:01"),
        }),
      ],
      drivers: [driver({ driverId: "A" })], // only one driver → must chain
      dutyDriverId: null,
      activeTjwCommitments: [],
    };
    const out = solveDay(input);
    expect(out.overflows).toHaveLength(0);
    expect(out.assignments.map((a) => a.primaryDriverId)).toEqual(["A", "A"]);
  });
});

describe("solveDay — needsSecondaryDriver requires secondary, all job types", () => {
  it("OT with needsSecondaryDriver gets a co-driver", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "ot1",
          jobType: "OT",
          startAt: D("2026-06-10T06:00:00"),
          endAt: D("2026-06-10T15:00:00"),
          needsSecondaryDriver: true,
        }),
      ],
      drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
      dutyDriverId: null,
      activeTjwCommitments: [],
    };
    const out = solveDay(input);
    expect(out.assignments[0]!.secondaryDriverId).toBe("B");
  });

  it("NORMAL with needsSecondaryDriver gets a co-driver", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "n1",
          jobType: "NORMAL",
          needsSecondaryDriver: true,
        }),
      ],
      drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
      dutyDriverId: null,
      activeTjwCommitments: [],
    };
    const out = solveDay(input);
    expect(out.assignments[0]!.secondaryDriverId).toBe("B");
  });
});

describe("solveDay — NEEDS_WERN_RECLAIM_DECISION", () => {
  it("flags reclaim escalation when only duty driver can be the secondary", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "ot1",
          jobType: "OT",
          startAt: D("2026-06-10T06:00:00"),
          endAt: D("2026-06-10T15:00:00"),
          needsSecondaryDriver: true,
        }),
      ],
      // A is duty, B is the only fresh; secondary needs another fresh but
      // none exists → only candidate is duty A.
      drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
      dutyDriverId: "A",
      activeTjwCommitments: [],
    };
    const out = solveDay(input);
    expect(out.overflows).toEqual([
      { bookingId: "ot1", reason: "NEEDS_WERN_RECLAIM_DECISION" },
    ]);
  });
});

describe("solveDay — Phase C TJW return-day fallback", () => {
  it("uses a TJW returnee as last resort for OT when fresh pool is empty", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "ot1",
          jobType: "OT",
          startAt: D("2026-06-10T17:30:00"),
          endAt: D("2026-06-10T20:00:00"),
        }),
      ],
      drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
      dutyDriverId: "B",
      activeTjwCommitments: [
        // A returned at 14:00 today (before 16:00 cutoff) → Phase-C eligible.
        { driverId: "A", startAt: D("2026-06-08T08:00:00"), endAt: D("2026-06-10T14:00:00") },
      ],
    };
    const out = solveDay(input);
    // A returned today before cutoff and is the only OT-eligible driver.
    expect(out.overflows).toHaveLength(0);
    expect(out.assignments[0]!.primaryDriverId).toBe("A");
  });

  it("returnee after the cutoff is NOT eligible", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "ot1",
          jobType: "OT",
          startAt: D("2026-06-10T17:30:00"),
          endAt: D("2026-06-10T20:00:00"),
        }),
      ],
      drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
      dutyDriverId: "B",
      activeTjwCommitments: [
        // A returns at 17:00 — after cutoff → not Phase-C eligible.
        { driverId: "A", startAt: D("2026-06-08T08:00:00"), endAt: D("2026-06-10T17:00:00") },
      ],
    };
    const out = solveDay(input);
    expect(out.assignments).toHaveLength(0);
    expect(out.overflows[0]!.reason).toBe("NO_PRIMARY_DRIVER");
  });
});

describe("solveDay — multi-day TJW away exclusion", () => {
  it("never assigns a driver who is mid multi-day TJW (away all day)", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [booking({ bookingId: "n1", jobType: "NORMAL" })],
      // A would normally win FCFS, but A is out on a 3-day TJW (Jun 9 → Jun 11);
      // today (Jun 10) is mid-trip, so A must be skipped entirely.
      drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
      dutyDriverId: null,
      activeTjwCommitments: [
        { driverId: "A", startAt: D("2026-06-09T06:00:00"), endAt: D("2026-06-11T18:00:00") },
      ],
    };
    const out = solveDay(input);
    expect(out.assignments).toHaveLength(1);
    expect(out.assignments[0]!.primaryDriverId).toBe("B");
  });
});

describe("solveDay — FCFS submitter order within a category", () => {
  it("earlier-submitted booking wins when drivers are scarce", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({ bookingId: "late",  submittedAt: D("2026-06-05T08:00:00") }),
        booking({ bookingId: "early", submittedAt: D("2026-06-01T08:00:00") }),
      ],
      drivers: [driver({ driverId: "A" })],
      dutyDriverId: null,
      activeTjwCommitments: [],
    };
    const out = solveDay(input);
    // Only A available → first FCFS wins, second overflows.
    expect(out.assignments[0]!.bookingId).toBe("early");
    expect(out.overflows[0]!.bookingId).toBe("late");
  });
});
