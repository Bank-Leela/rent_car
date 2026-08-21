import { describe, expect, it } from "vitest";
import { conflictingBookingIds, type DayBooking } from "@/lib/booking/calendar-conflicts";

const at = (h: number, m = 0) => new Date(2026, 8, 1, h, m, 0, 0);
const mk = (o: Partial<DayBooking> & { id: string; startAt: Date; endAt: Date }): DayBooking => ({
  vehicleId: "car1",
  status: "ASSIGNED",
  ...o,
});

describe("conflictingBookingIds", () => {
  it("flags a trip contained inside a longer one, even behind a nearer neighbour", () => {
    // The adjacent-pair version sorted by startAt and compared i-1 vs i, so C —
    // which sits entirely inside A — was never compared with A at all.
    const flagged = conflictingBookingIds([
      mk({ id: "A", startAt: at(8), endAt: at(18) }),
      mk({ id: "B", startAt: at(9), endAt: at(9, 30) }),
      mk({ id: "C", startAt: at(17), endAt: at(17, 30) }),
    ]);
    expect([...flagged].sort()).toEqual(["A", "B", "C"]);
  });

  it("does not flag a §5c in-Chula pair", () => {
    const flagged = conflictingBookingIds([
      mk({ id: "P", startAt: at(9), endAt: at(10), travelWithinChula: true }),
      mk({ id: "Q", startAt: at(9, 5), endAt: at(10), travelWithinChula: true }),
    ]);
    expect([...flagged]).toEqual([]);
  });

  it("still flags in-Chula trips outside the pairing window", () => {
    const flagged = conflictingBookingIds([
      mk({ id: "P", startAt: at(9), endAt: at(12), travelWithinChula: true }),
      mk({ id: "R", startAt: at(10), endAt: at(11), travelWithinChula: true }),
    ]);
    expect([...flagged].sort()).toEqual(["P", "R"]);
  });

  it("frees the middle of a no-wait trip", () => {
    // Drops off at 09:00, returns to collect at 16:00 — the car is genuinely
    // available in between, which a whole-window comparison could not see.
    const flagged = conflictingBookingIds([
      mk({
        id: "NW", startAt: at(8), endAt: at(17),
        waitAtDestination: false, dropOffDone: at(9), pickupReturnTime: "16:00",
      }),
      mk({ id: "MID", startAt: at(11), endAt: at(12) }),
    ]);
    expect([...flagged]).toEqual([]);
  });

  it("leaves different cars alone", () => {
    const flagged = conflictingBookingIds([
      mk({ id: "A", startAt: at(9), endAt: at(10) }),
      mk({ id: "B", startAt: at(9), endAt: at(10), vehicleId: "car2" }),
    ]);
    expect([...flagged]).toEqual([]);
  });
});
