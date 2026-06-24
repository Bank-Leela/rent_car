import { describe, expect, it } from "vitest";
import {
  canChain,
  canTake,
  pickGeneralRank,
  rankForRotation,
  type DriverRotationState,
} from "./rotations";
import type { JobType } from "@prisma/client";

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

describe("canTake", () => {
  const morning = { startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-10T11:00:00") };
  const afternoonOk = { startAt: D("2026-06-10T13:00:00"), endAt: D("2026-06-10T16:00:00") };
  const afternoonTooSoon = { startAt: D("2026-06-10T12:30:00"), endAt: D("2026-06-10T15:00:00") };

  const wrap = (t: { startAt: Date; endAt: Date }) => ({
    id: "x", jobType: "NORMAL" as const, ...t,
  });

  it("first job of the day is always fine", () => {
    expect(canTake(morning, [])).toBe(true);
  });
  it("morning→afternoon with 2h gap is allowed", () => {
    expect(canTake(afternoonOk, [wrap(morning)])).toBe(true);
  });
  it("morning→afternoon without 2h gap is rejected", () => {
    expect(canTake(afternoonTooSoon, [wrap(morning)])).toBe(false);
  });
  it("third job same day is rejected", () => {
    expect(canTake(afternoonOk, [wrap(morning), wrap(afternoonOk)])).toBe(false);
  });
  it("overlap is rejected even with otherwise valid gap", () => {
    expect(canTake({ startAt: D("2026-06-10T10:00:00"), endAt: D("2026-06-10T12:00:00") }, [wrap(morning)])).toBe(false);
  });
});

describe("canTake — job-type-aware (OT uncapped, 2h gap universal)", () => {
  const mk = (s: string, e: string, jobType: JobType = "NORMAL") => ({ id: "x", jobType, startAt: D(s), endAt: D(e) });
  const morningN = mk("2026-06-10T08:00:00", "2026-06-10T11:00:00");
  const afternoonN = mk("2026-06-10T13:00:00", "2026-06-10T16:00:00");

  it("OT stacks on top of a full morning+afternoon NORMAL day (exempt from the cap)", () => {
    const eveningOt = { startAt: D("2026-06-10T18:00:00"), endAt: D("2026-06-10T20:00:00"), jobType: "OT" as const };
    expect(canTake(eveningOt, [morningN, afternoonN])).toBe(true);
  });

  it("OT still obeys the 2h gap: ends 06:00 allows an 08:00 job, ends 06:30 blocks it", () => {
    const job8 = { startAt: D("2026-06-10T08:00:00"), endAt: D("2026-06-10T10:00:00"), jobType: "NORMAL" as const };
    expect(canTake(job8, [mk("2026-06-10T04:00:00", "2026-06-10T06:00:00", "OT")])).toBe(true);
    expect(canTake(job8, [mk("2026-06-10T04:30:00", "2026-06-10T06:30:00", "OT")])).toBe(false);
  });

  it("two morning NORMALs are rejected (only one morning + one afternoon)", () => {
    const existingMorning = mk("2026-06-10T08:00:00", "2026-06-10T09:00:00");
    const secondMorning = { startAt: D("2026-06-10T11:00:00"), endAt: D("2026-06-10T12:00:00"), jobType: "NORMAL" as const };
    expect(canTake(secondMorning, [existingMorning])).toBe(false);
  });

  it("an existing OT does not consume the NORMAL morning/afternoon slots", () => {
    const earlyOt = mk("2026-06-10T04:00:00", "2026-06-10T06:00:00", "OT");
    expect(canTake(morningN, [earlyOt])).toBe(true);
    expect(canTake(afternoonN, [earlyOt, morningN])).toBe(true);
  });
});

describe("rankForRotation (oldest-first, ledger tie-break)", () => {
  const top = (
    rows: DriverRotationState[],
    key: (d: DriverRotationState) => Date | null,
  ) => rankForRotation(rows, key)[0] ?? null;

  it("driver with null timestamp wins over anyone with a real one", () => {
    const got = top([
      driver({ driverId: "A", lastTjwAt: D("2026-05-01") }),
      driver({ driverId: "B", lastTjwAt: null }),
      driver({ driverId: "C", lastTjwAt: D("2026-04-15") }),
    ], (d) => d.lastTjwAt);
    expect(got).toBe("B");
  });

  it("among real timestamps the oldest wins", () => {
    const got = top([
      driver({ driverId: "A", lastTjwAt: D("2026-05-10") }),
      driver({ driverId: "B", lastTjwAt: D("2026-05-01") }),
      driver({ driverId: "C", lastTjwAt: D("2026-05-05") }),
    ], (d) => d.lastTjwAt);
    expect(got).toBe("B");
  });

  it("ties break on the general ledger (lowest earnings first)", () => {
    const got = top([
      driver({ driverId: "A", lastTjwAt: D("2026-05-10"), earningsScore: 5 }),
      driver({ driverId: "B", lastTjwAt: D("2026-05-10"), earningsScore: 2 }),
    ], (d) => d.lastTjwAt);
    expect(got).toBe("B");
  });

  it("works on any category key (e.g. lastOtAt) independently", () => {
    const got = top([
      driver({ driverId: "A", lastOtAt: D("2026-05-10"), lastTjwAt: D("2026-05-15") }),
      driver({ driverId: "B", lastOtAt: D("2026-05-01"), lastTjwAt: null }),
    ], (d) => d.lastOtAt);
    expect(got).toBe("B");
  });
});

describe("pickGeneralRank", () => {
  it("returns full ordering by earnings → lastAssignedAt → driverId", () => {
    const out = pickGeneralRank([
      driver({ driverId: "A", earningsScore: 5, lastAssignedAt: D("2026-05-10") }),
      driver({ driverId: "B", earningsScore: 5, lastAssignedAt: D("2026-05-01") }),
      driver({ driverId: "C", earningsScore: 3, lastAssignedAt: D("2026-05-20") }),
    ]);
    expect(out).toEqual(["C", "B", "A"]);
  });
});

describe("rankForRotation deadlock check", () => {
  // Update 5 of the change log: timestamp rotation must not deadlock when
  // one driver is away. Simulate 4 OT days with B unavailable.
  it("keeps cycling through available drivers when one is permanently absent", () => {
    let state: DriverRotationState[] = ["A", "B", "C", "D"].map((id) =>
      driver({ driverId: id, lastOtAt: null }),
    );
    const absent = new Set(["B"]);
    const assigned: string[] = [];
    for (let day = 0; day < 4; day++) {
      const eligible = state.filter((d) => !absent.has(d.driverId));
      const ranked = rankForRotation(eligible, (d) => d.lastOtAt);
      const picked = ranked[0]!;
      assigned.push(picked);
      const stamp = new Date(`2026-06-${10 + day}T08:00:00`);
      state = state.map((d) => (d.driverId === picked ? { ...d, lastOtAt: stamp } : d));
    }
    // All four days assigned to live drivers (never null due to no eligible).
    expect(assigned).toHaveLength(4);
    expect(assigned.every((id) => !absent.has(id))).toBe(true);
    // Each of the three available drivers got at least one trip
    // (3 drivers, 4 days, so one gets a second turn — the first picked).
    expect(new Set(assigned).size).toBe(3);
  });

  // Sick-day self-heal: a driver excluded for a few days keeps their rotation
  // timestamp old while others advance, so on return they're picked FIRST
  // (catch-up) — no penalty, no manual fairness adjustment.
  it("picks the returning sick driver first (rotation self-heals)", () => {
    let state: DriverRotationState[] = ["A", "B", "C"].map((id) =>
      driver({ driverId: id, lastOtAt: null }),
    );
    // B is out (sick) days 0–2; A and C work and advance their lastOtAt.
    for (let day = 0; day < 3; day++) {
      const eligible = state.filter((d) => d.driverId !== "B");
      const picked = rankForRotation(eligible, (d) => d.lastOtAt)[0]!;
      expect(picked).not.toBe("B");
      const stamp = new Date(`2026-06-${10 + day}T08:00:00`);
      state = state.map((d) => (d.driverId === picked ? { ...d, lastOtAt: stamp } : d));
    }
    // Day 3 — B returns. Oldest (null) timestamp ⇒ ranked first.
    const ranked = rankForRotation(state, (d) => d.lastOtAt);
    expect(ranked[0]).toBe("B");
  });
});

describe("canChain — 2h-gap boundaries + NORMAL cap shapes", () => {
  const N = (s: string, e: string, jobType: JobType = "NORMAL") => ({ startAt: D(s), endAt: D(e), jobType });

  it("symmetric gap (new precedes existing): exactly 2h ok, 1 minute short blocked", () => {
    const existing = [N("2026-06-10T08:00:00", "2026-06-10T10:00:00")];
    expect(canChain(N("2026-06-10T04:00:00", "2026-06-10T06:00:00", "OT"), existing)).toBe(true); // ends 06:00, +2h = 08:00
    expect(canChain(N("2026-06-10T04:00:00", "2026-06-10T06:01:00", "OT"), existing)).toBe(false); // 1h59m
  });

  it("an OT overlapping an existing trip is rejected (overlap beats the cap exemption)", () => {
    expect(
      canChain(N("2026-06-10T10:00:00", "2026-06-10T12:00:00", "OT"), [N("2026-06-10T08:00:00", "2026-06-10T11:00:00", "OT")]),
    ).toBe(false);
  });

  it("OT is exempt from the 2-NORMAL cap — stacks on a full day, but still needs the gap", () => {
    const fullDay = [N("2026-06-10T08:00:00", "2026-06-10T11:00:00"), N("2026-06-10T13:00:00", "2026-06-10T16:00:00")];
    expect(canChain(N("2026-06-10T18:00:00", "2026-06-10T20:00:00", "OT"), fullDay)).toBe(true); // 2h after 16:00
    expect(canChain(N("2026-06-10T17:00:00", "2026-06-10T19:00:00", "OT"), fullDay)).toBe(false); // 1h after 16:00
  });

  it("NORMAL cap rejects two afternoons", () => {
    expect(
      canChain(N("2026-06-10T15:00:00", "2026-06-10T16:00:00"), [N("2026-06-10T12:00:00", "2026-06-10T13:00:00")]),
    ).toBe(false);
  });

  it("NORMAL cap rejects a midday straddler + another NORMAL", () => {
    // existing 11:00–13:00 straddles noon (neither a clean morning nor afternoon)
    expect(
      canChain(N("2026-06-10T15:00:00", "2026-06-10T16:00:00"), [N("2026-06-10T11:00:00", "2026-06-10T13:00:00")]),
    ).toBe(false);
  });

  it("NORMAL cap allows a clean morning (ends ≤12) + afternoon (starts ≥12) with the 2h gap", () => {
    expect(
      canChain(N("2026-06-10T13:00:00", "2026-06-10T15:00:00"), [N("2026-06-10T08:00:00", "2026-06-10T11:00:00")]),
    ).toBe(true);
  });

  it("exact-12:00 edge: a trip ending 12:00 is a morning, one starting 12:00 is an afternoon", () => {
    // morning ends 12:00, afternoon starts 14:00 (2h gap) → valid pair
    expect(
      canChain(N("2026-06-10T14:00:00", "2026-06-10T16:00:00"), [N("2026-06-10T08:00:00", "2026-06-10T12:00:00")]),
    ).toBe(true);
  });
});
