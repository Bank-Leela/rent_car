import { describe, expect, it } from "vitest";
import { checkInvariants, type AssignedTrip } from "./sim-invariants";

const D = (s: string) => new Date(s);
const trip = (
  o: Omit<Partial<AssignedTrip>, "startAt" | "endAt"> & { bookingId: string; startAt: string; endAt: string },
): AssignedTrip => ({
  driverId: "A",
  jobType: "NORMAL",
  waitAtDestination: true,
  dropOffDone: null,
  pickupReturnTime: null,
  ...o,
  startAt: D(o.startAt),
  endAt: D(o.endAt),
});

describe("checkInvariants", () => {
  it("clean schedule → no violations", () => {
    const v = checkInvariants([
      trip({ bookingId: "1", startAt: "2026-07-01T08:00", endAt: "2026-07-01T10:00" }),
      trip({ bookingId: "2", startAt: "2026-07-01T13:00", endAt: "2026-07-01T15:00" }),
    ]);
    expect(v).toHaveLength(0);
  });

  it("catches a planted DOUBLE_BOOK (overlapping, same driver)", () => {
    const v = checkInvariants([
      trip({ bookingId: "1", startAt: "2026-07-01T08:00", endAt: "2026-07-01T11:00" }),
      trip({ bookingId: "2", startAt: "2026-07-01T10:00", endAt: "2026-07-01T12:00" }),
    ]);
    expect(v.map((x) => x.type)).toContain("DOUBLE_BOOK");
  });

  it("catches a sub-2h GAP_2H", () => {
    const v = checkInvariants([
      trip({ bookingId: "1", startAt: "2026-07-01T08:00", endAt: "2026-07-01T10:00" }),
      trip({ bookingId: "2", startAt: "2026-07-01T11:00", endAt: "2026-07-01T13:00" }), // 1h gap
    ]);
    expect(v.map((x) => x.type)).toContain("GAP_2H");
  });

  it("catches NORMAL > 2/day", () => {
    const v = checkInvariants([
      trip({ bookingId: "1", startAt: "2026-07-01T06:00", endAt: "2026-07-01T07:00" }),
      trip({ bookingId: "2", startAt: "2026-07-01T09:00", endAt: "2026-07-01T10:00" }),
      trip({ bookingId: "3", startAt: "2026-07-01T13:00", endAt: "2026-07-01T14:00" }),
    ]);
    expect(v.map((x) => x.type)).toContain("NORMAL_CAP");
  });

  it("catches AWAY_CONFLICT (trip during a driver's multi-day ตจว)", () => {
    const v = checkInvariants([
      trip({ bookingId: "tjw", jobType: "TJW", startAt: "2026-07-01T08:00", endAt: "2026-07-03T18:00" }),
      trip({ bookingId: "x", startAt: "2026-07-02T09:00", endAt: "2026-07-02T11:00" }),
    ]);
    expect(v.map((x) => x.type)).toContain("AWAY_CONFLICT");
  });

  it("no-wait freed middle is NOT a double-book (leg-aware)", () => {
    // No-wait trip occupies 08–10 and 15:30–18; another trip fills the freed middle
    // 12:00–13:00 — clear of both legs AND ≥2h from each (gap rule still applies).
    const v = checkInvariants([
      trip({
        bookingId: "nowait", driverId: "A",
        startAt: "2026-07-01T08:00", endAt: "2026-07-01T18:00",
        waitAtDestination: false, dropOffDone: D("2026-07-01T10:00"), pickupReturnTime: "15:30",
      }),
      trip({ bookingId: "mid", driverId: "A", startAt: "2026-07-01T12:00", endAt: "2026-07-01T13:00" }),
    ]);
    expect(v).toHaveLength(0);
  });

  it("different drivers never conflict", () => {
    const v = checkInvariants([
      trip({ bookingId: "1", driverId: "A", startAt: "2026-07-01T08:00", endAt: "2026-07-01T12:00" }),
      trip({ bookingId: "2", driverId: "B", startAt: "2026-07-01T08:00", endAt: "2026-07-01T12:00" }),
    ]);
    expect(v).toHaveLength(0);
  });
});
