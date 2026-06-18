import { describe, expect, it } from "vitest";
import type { JobType } from "@prisma/client";
import { pickConflictLoser, findConflictLosers, type ConflictTrip } from "./conflict-resolve";

const SUBMIT = new Date("2026-06-01T00:00:00");

function trip(over: Partial<ConflictTrip> & { id: string }): ConflictTrip {
  return {
    vehicleId: "car-1",
    startAt: new Date("2026-06-18T09:00:00"),
    endAt: new Date("2026-06-18T11:00:00"),
    jobType: "NORMAL" as JobType,
    submittedAt: SUBMIT,
    ...over,
  };
}

describe("pickConflictLoser", () => {
  it("moves the lower category priority (NORMAL loses to TJW)", () => {
    const tjw = trip({ id: "tjw", jobType: "TJW" });
    const normal = trip({ id: "normal", jobType: "NORMAL" });
    expect(pickConflictLoser(tjw, normal).id).toBe("normal");
    expect(pickConflictLoser(normal, tjw).id).toBe("normal"); // order-independent
  });

  it("respects the order among non-duty types TJW > OT > NORMAL", () => {
    const order: JobType[] = ["TJW", "OT", "NORMAL"];
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const hi = trip({ id: `hi-${i}`, jobType: order[i] });
        const lo = trip({ id: `lo-${j}`, jobType: order[j] });
        expect(pickConflictLoser(hi, lo).id).toBe(`lo-${j}`);
      }
    }
  });

  it("WERN/duty is pinned — never the loser, the intruder moves (even a TJW)", () => {
    for (const other of ["TJW", "OT", "NORMAL"] as JobType[]) {
      const wern = trip({ id: "wern", jobType: "WERN" });
      const x = trip({ id: "x", jobType: other });
      expect(pickConflictLoser(wern, x).id).toBe("x");
      expect(pickConflictLoser(x, wern).id).toBe("x"); // order-independent
    }
  });

  it("same priority → the later-submitted trip moves", () => {
    const early = trip({ id: "early", submittedAt: new Date("2026-06-01T08:00:00") });
    const late = trip({ id: "late", submittedAt: new Date("2026-06-02T08:00:00") });
    expect(pickConflictLoser(early, late).id).toBe("late");
    expect(pickConflictLoser(late, early).id).toBe("late");
  });

  it("identical priority + submit time → deterministic by id", () => {
    const a = trip({ id: "aaa" });
    const b = trip({ id: "bbb" });
    expect(pickConflictLoser(a, b).id).toBe("bbb");
    expect(pickConflictLoser(b, a).id).toBe("bbb");
  });
});

describe("findConflictLosers", () => {
  it("no overlap → no losers", () => {
    const losers = findConflictLosers([
      trip({ id: "a", startAt: new Date("2026-06-18T09:00:00"), endAt: new Date("2026-06-18T11:00:00") }),
      trip({ id: "b", startAt: new Date("2026-06-18T11:00:00"), endAt: new Date("2026-06-18T13:00:00") }),
    ]);
    expect(losers.size).toBe(0);
  });

  it("touching edges do not count as overlap", () => {
    const losers = findConflictLosers([
      trip({ id: "a", endAt: new Date("2026-06-18T11:00:00") }),
      trip({ id: "b", startAt: new Date("2026-06-18T11:00:00"), endAt: new Date("2026-06-18T12:00:00") }),
    ]);
    expect(losers.size).toBe(0);
  });

  it("one overlapping pair → the lower-priority loser", () => {
    const losers = findConflictLosers([
      trip({ id: "tjw", jobType: "TJW", startAt: new Date("2026-06-18T09:00:00"), endAt: new Date("2026-06-18T12:00:00") }),
      trip({ id: "normal", jobType: "NORMAL", startAt: new Date("2026-06-18T10:00:00"), endAt: new Date("2026-06-18T11:00:00") }),
    ]);
    expect([...losers]).toEqual(["normal"]);
  });

  it("WERN overlapping a higher-priority trip → the intruder moves, WERN stays", () => {
    const losers = findConflictLosers([
      trip({ id: "wern", jobType: "WERN", startAt: new Date("2026-06-18T08:00:00"), endAt: new Date("2026-06-18T16:00:00") }),
      trip({ id: "ot", jobType: "OT", startAt: new Date("2026-06-18T09:00:00"), endAt: new Date("2026-06-18T11:00:00") }),
    ]);
    expect([...losers]).toEqual(["ot"]); // WERN pinned, never moves off the duty car
  });

  it("isolates by car — overlap on different cars is not a conflict", () => {
    const losers = findConflictLosers([
      trip({ id: "a", vehicleId: "car-1" }),
      trip({ id: "b", vehicleId: "car-2" }), // same time, different car
    ]);
    expect(losers.size).toBe(0);
  });

  it("3-way mutual overlap on one car → both lower trips move, top stays", () => {
    const losers = findConflictLosers([
      trip({ id: "tjw", jobType: "TJW", startAt: new Date("2026-06-18T09:00:00"), endAt: new Date("2026-06-18T13:00:00") }),
      trip({ id: "ot", jobType: "OT", startAt: new Date("2026-06-18T09:30:00"), endAt: new Date("2026-06-18T12:00:00") }),
      trip({ id: "normal", jobType: "NORMAL", startAt: new Date("2026-06-18T10:00:00"), endAt: new Date("2026-06-18T11:00:00") }),
    ]);
    expect(losers.has("tjw")).toBe(false);
    expect(losers.has("ot")).toBe(true);
    expect(losers.has("normal")).toBe(true);
  });
});
