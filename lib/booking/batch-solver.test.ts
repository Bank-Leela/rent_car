import { describe, expect, it } from "vitest";
import { solveDay, LONG_TRIP_KM, type SolverInput, type SolverBookingInput } from "./batch-solver";
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
    estimatedDistance: 50,
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
          estimatedDistance: 200,
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

describe("solveDay — >400 km requires secondary, all job types", () => {
  it("OT >400 km gets a co-driver", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "ot1",
          jobType: "OT",
          startAt: D("2026-06-10T06:00:00"),
          endAt: D("2026-06-10T15:00:00"),
          estimatedDistance: LONG_TRIP_KM + 50,
        }),
      ],
      drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
      dutyDriverId: null,
      activeTjwCommitments: [],
    };
    const out = solveDay(input);
    expect(out.assignments[0]!.secondaryDriverId).toBe("B");
  });

  it("NORMAL >400 km gets a co-driver", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "n1",
          jobType: "NORMAL",
          estimatedDistance: LONG_TRIP_KM + 50,
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
          estimatedDistance: LONG_TRIP_KM + 50,
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
          estimatedDistance: 100,
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
          estimatedDistance: 100,
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

describe("solveDay — existing same-day assignments block non-duty overlap", () => {
  it("does not stack an overlapping trip on a non-duty driver already booked", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "n1",
          jobType: "NORMAL",
          startAt: D("2026-06-10T09:00:00"),
          endAt: D("2026-06-10T11:00:00"),
        }),
      ],
      // Sole eligible driver already holds an overlapping trip today.
      drivers: [driver({ driverId: "A" })],
      dutyDriverId: null,
      activeTjwCommitments: [],
      existingByDriver: new Map([
        [
          "A",
          [
            {
              id: "x",
              jobType: "NORMAL",
              startAt: D("2026-06-10T08:30:00"),
              endAt: D("2026-06-10T10:00:00"),
            },
          ],
        ],
      ]),
    };
    const out = solveDay(input);
    expect(out.assignments).toHaveLength(0);
    expect(out.overflows).toEqual([{ bookingId: "n1", reason: "NO_PRIMARY_DRIVER" }]);
  });

  it("an OT already on a driver does not block their afternoon NORMAL (OT is not a coverage slot)", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "pm",
          jobType: "NORMAL",
          startAt: D("2026-06-10T13:00:00"),
          endAt: D("2026-06-10T15:00:00"),
        }),
      ],
      drivers: [driver({ driverId: "A" })],
      dutyDriverId: null,
      activeTjwCommitments: [],
      existingByDriver: new Map([
        [
          "A",
          [
            { id: "ot", jobType: "OT", startAt: D("2026-06-10T04:00:00"), endAt: D("2026-06-10T06:00:00") },
            { id: "am", jobType: "NORMAL", startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-10T10:00:00") },
          ],
        ],
      ]),
    };
    const out = solveDay(input);
    expect(out.assignments).toHaveLength(1);
    expect(out.assignments[0]!.primaryDriverId).toBe("A");
  });

  it("still allows a non-overlapping morning→afternoon chain on an already-booked driver", () => {
    const input: SolverInput = {
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "pm",
          jobType: "NORMAL",
          startAt: D("2026-06-10T13:00:00"),
          endAt: D("2026-06-10T15:00:00"),
        }),
      ],
      drivers: [driver({ driverId: "A" })],
      dutyDriverId: null,
      activeTjwCommitments: [],
      existingByDriver: new Map([
        [
          "A",
          [
            {
              id: "am",
              jobType: "NORMAL",
              startAt: D("2026-06-10T08:00:00"),
              endAt: D("2026-06-10T10:00:00"),
            },
          ],
        ],
      ]),
    };
    const out = solveDay(input);
    expect(out.assignments).toHaveLength(1);
    expect(out.assignments[0]!.primaryDriverId).toBe("A");
  });
});

describe("solveDay — NO_SECONDARY_DRIVER (long trip, no co-driver, no duty to reclaim)", () => {
  it("overflows NO_SECONDARY_DRIVER, not NEEDS_WERN_RECLAIM, when there is no duty driver", () => {
    const out = solveDay({
      date: D("2026-06-10"),
      bookings: [
        booking({
          bookingId: "t",
          jobType: "TJW",
          outOfProvince: true,
          startAt: D("2026-06-10T06:00:00"),
          endAt: D("2026-06-11T18:00:00"),
          estimatedDistance: 500,
        }),
      ],
      drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
      dutyDriverId: null, // nothing to reclaim
      activeTjwCommitments: [],
      // B is busy across the TJW span → A is the only fresh driver (primary), no secondary.
      existingByDriver: new Map([
        ["B", [{ id: "x", jobType: "NORMAL", startAt: D("2026-06-10T06:00:00"), endAt: D("2026-06-11T18:00:00") }]],
      ]),
    });
    expect(out.overflows).toEqual([{ bookingId: "t", reason: "NO_SECONDARY_DRIVER" }]);
  });
});

describe("solveDay — wernReclaimPolicy (docs §6b)", () => {
  // A long OT staffable only by reclaiming the duty driver (A) as the co-driver:
  // primary = B (the lone fresh driver), no fresh secondary, duty A could fit.
  const reclaimInput = (policy?: "ESCALATE" | "AUTO_RECLAIM" | "PROTECT_WERN"): SolverInput => ({
    date: D("2026-06-10"),
    bookings: [
      booking({
        bookingId: "ot1",
        jobType: "OT",
        startAt: D("2026-06-10T06:00:00"),
        endAt: D("2026-06-10T15:00:00"),
        estimatedDistance: LONG_TRIP_KM + 50,
      }),
    ],
    drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
    dutyDriverId: "A",
    activeTjwCommitments: [],
    config: policy ? { wernReclaimPolicy: policy } : undefined,
  });

  it("ESCALATE (default) raises NEEDS_WERN_RECLAIM_DECISION for the admin", () => {
    for (const p of [undefined, "ESCALATE"] as const) {
      const out = solveDay(reclaimInput(p));
      expect(out.assignments).toHaveLength(0);
      expect(out.overflows).toEqual([{ bookingId: "ot1", reason: "NEEDS_WERN_RECLAIM_DECISION" }]);
    }
  });

  it("AUTO_RECLAIM takes the duty driver as the co-driver — no overflow", () => {
    const out = solveDay(reclaimInput("AUTO_RECLAIM"));
    expect(out.overflows).toHaveLength(0);
    expect(out.assignments).toEqual([
      { bookingId: "ot1", primaryDriverId: "B", secondaryDriverId: "A", jobType: "OT" },
    ]);
  });

  it("PROTECT_WERN never reclaims duty — overflows NO_SECONDARY_DRIVER instead", () => {
    const out = solveDay(reclaimInput("PROTECT_WERN"));
    expect(out.assignments).toHaveLength(0);
    expect(out.overflows).toEqual([{ bookingId: "ot1", reason: "NO_SECONDARY_DRIVER" }]);
  });
});

describe("solveDay — fcfsOverridesCategoryPriority", () => {
  // 1 driver, a NORMAL (submitted earlier) + a TJW (submitted later) that
  // overlap on the day → only one can be placed.
  const bookings = [
    booking({ bookingId: "n1", jobType: "NORMAL", submittedAt: D("2026-06-01T08:00:00") }),
    booking({
      bookingId: "t1",
      jobType: "TJW",
      outOfProvince: true,
      startAt: D("2026-06-10T06:00:00"),
      endAt: D("2026-06-11T18:00:00"),
      estimatedDistance: 100,
      submittedAt: D("2026-06-05T08:00:00"),
    }),
  ];
  const drivers = [driver({ driverId: "A" })];

  it("default category priority places the TJW first (NORMAL overflows)", () => {
    const out = solveDay({ date: D("2026-06-10"), bookings, drivers, dutyDriverId: null, activeTjwCommitments: [] });
    expect(out.assignments[0]!.bookingId).toBe("t1");
    expect(out.overflows[0]!.bookingId).toBe("n1");
  });

  it("FCFS override places the earlier-submitted NORMAL first (TJW overflows)", () => {
    const out = solveDay({
      date: D("2026-06-10"),
      bookings,
      drivers,
      dutyDriverId: null,
      activeTjwCommitments: [],
      config: { fcfsOverridesCategoryPriority: true },
    });
    expect(out.assignments[0]!.bookingId).toBe("n1");
    expect(out.overflows[0]!.bookingId).toBe("t1");
  });
});

describe("solveDay — category rotation + distance boundary", () => {
  const longTrip = (dist: number | null) => ({
    date: D("2026-06-10"),
    bookings: [
      booking({
        bookingId: "t",
        jobType: "TJW" as const,
        outOfProvince: true,
        startAt: D("2026-06-10T06:00:00"),
        endAt: D("2026-06-11T18:00:00"),
        estimatedDistance: dist,
      }),
    ],
    drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
    dutyDriverId: null,
    activeTjwCommitments: [],
  });

  it("TJW goes to the oldest lastTjwAt (null = oldest = first)", () => {
    const out = solveDay({
      ...longTrip(100),
      drivers: [driver({ driverId: "A", lastTjwAt: D("2026-06-01") }), driver({ driverId: "B", lastTjwAt: null })],
    });
    expect(out.assignments[0]!.primaryDriverId).toBe("B");
  });

  it("400 km → no co-driver; 401 km → co-driver; null → no co-driver", () => {
    expect(solveDay(longTrip(400)).assignments[0]!.secondaryDriverId).toBeNull();
    expect(solveDay(longTrip(401)).assignments[0]!.secondaryDriverId).toBeTruthy();
    expect(solveDay(longTrip(null)).assignments[0]!.secondaryDriverId).toBeNull();
  });
});

describe("solveDay — WERN goes to the on-call duty driver (docs §1)", () => {
  const wern = () =>
    booking({ bookingId: "w1", jobType: "WERN", startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-10T12:00:00") });

  it("assigns a WERN slot to the rostered duty driver, not a fair pick", () => {
    const out = solveDay({
      date: D("2026-06-10"),
      bookings: [wern()],
      // A is the on-call driver; without the fix A is reserved out and B wins.
      drivers: [driver({ driverId: "A" }), driver({ driverId: "B" })],
      dutyDriverId: "A",
      activeTjwCommitments: [],
    });
    expect(out.overflows).toHaveLength(0);
    expect(out.assignments[0]).toMatchObject({ bookingId: "w1", primaryDriverId: "A" });
  });

  it("falls back to the duty rotation when no on-call driver is rostered", () => {
    const out = solveDay({
      date: D("2026-06-10"),
      bookings: [wern()],
      drivers: [driver({ driverId: "A", lastDutyAt: D("2026-06-01") }), driver({ driverId: "B", lastDutyAt: null })],
      dutyDriverId: null, // no OnCallShift → pickDutyRotation (null lastDutyAt = oldest → B)
      activeTjwCommitments: [],
    });
    expect(out.assignments[0]?.primaryDriverId).toBe("B");
  });
});

describe("solveDay — no-wait split frees the middle", () => {
  // An existing no-wait split on driver A: legs 08:00–10:00 and 15:30–18:00.
  const split = {
    id: "split",
    startAt: D("2026-06-10T08:00:00"),
    endAt: D("2026-06-10T18:00:00"),
    jobType: "OT" as const,
    waitAtDestination: false,
    dropOffDone: D("2026-06-10T10:00:00"),
    pickupReturnTime: "15:30",
  };
  const base = (fillerStart: string, fillerEnd: string): SolverInput => ({
    date: D("2026-06-10"),
    bookings: [booking({ bookingId: "f", jobType: "OT", startAt: D(fillerStart), endAt: D(fillerEnd) })],
    drivers: [driver({ driverId: "A" })], // only driver → filler must fit A's gap
    dutyDriverId: null,
    activeTjwCommitments: [],
    existingByDriver: new Map([["A", [split]]]),
  });

  it("places a filler that fits the freed gap (≥2h to each leg)", () => {
    const out = solveDay(base("2026-06-10T12:00:00", "2026-06-10T13:00:00"));
    expect(out.overflows).toHaveLength(0);
    expect(out.assignments.map((a) => a.primaryDriverId)).toEqual(["A"]);
  });

  it("overflows a filler that overlaps a leg (no free driver)", () => {
    const out = solveDay(base("2026-06-10T16:00:00", "2026-06-10T17:00:00"));
    expect(out.assignments).toHaveLength(0);
    expect(out.overflows).toHaveLength(1);
  });
});
