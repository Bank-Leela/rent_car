import { describe, it, expect } from "vitest";
import { BookingStatus } from "@prisma/client";
import {
  bookingHalf,
  dayCapacity,
  isFull,
  submitStatus,
  dayWindow,
  SLOT_HOLDING_STATUSES,
} from "./slot-capacity";

describe("bookingHalf", () => {
  it("splits at noon", () => {
    expect(bookingHalf(new Date("2026-06-12T08:00:00"))).toBe("MORNING");
    expect(bookingHalf(new Date("2026-06-12T11:59:00"))).toBe("MORNING");
    expect(bookingHalf(new Date("2026-06-12T12:00:00"))).toBe("AFTERNOON");
    expect(bookingHalf(new Date("2026-06-12T17:00:00"))).toBe("AFTERNOON");
  });
});

describe("dayCapacity", () => {
  it("counts morning+afternoon per non-duty car plus one spare per duty car", () => {
    expect(dayCapacity(5, 1)).toBe(11); // 5 cars x 2 + 1 เวร
    expect(dayCapacity(5, 0)).toBe(10);
    expect(dayCapacity(0, 0)).toBe(0);
    expect(dayCapacity(3, 2)).toBe(8);
  });
});

describe("isFull", () => {
  it("full once used reaches capacity", () => {
    expect(isFull(10, 11)).toBe(false);
    expect(isFull(11, 11)).toBe(true);
    expect(isFull(12, 11)).toBe(true);
  });
  it("never full when no slots configured", () => {
    expect(isFull(0, 0)).toBe(false);
    expect(isFull(5, 0)).toBe(false);
  });
});

describe("submitStatus", () => {
  it("guarantees within capacity, waitlists over", () => {
    expect(submitStatus(10, 11)).toBe("PENDING_APPROVAL");
    expect(submitStatus(11, 11)).toBe("WAITLIST");
  });
});

describe("dayWindow", () => {
  it("spans midnight to next midnight", () => {
    const { start, end } = dayWindow(new Date("2026-06-12T14:30:00"));
    expect(start.getHours()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("zeroes the time fields and does not mutate the input", () => {
    const input = new Date("2026-06-12T14:30:45.500");
    const t0 = input.getTime();
    const { start } = dayWindow(input);
    expect([start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    expect(input.getTime()).toBe(t0);
  });
});

describe("dayCapacity / submitStatus — edges", () => {
  it("a duty-only fleet still has capacity (one spare per duty car)", () => {
    expect(dayCapacity(0, 2)).toBe(2);
    expect(dayCapacity(0, 1)).toBe(1);
  });

  it("capacity 0 never waitlists (no vehicles configured → always guaranteed)", () => {
    expect(submitStatus(99, 0)).toBe("PENDING_APPROVAL");
    expect(isFull(99, 0)).toBe(false);
  });

  it("waitlists at or over capacity", () => {
    expect(submitStatus(12, 11)).toBe("WAITLIST");
  });
});

describe("SLOT_HOLDING_STATUSES", () => {
  // Stated as the RULE, over the live enum, rather than as a copy of the list.
  // The previous version pinned the four literals, so when AWAITING_DOCUMENT was
  // added to the pipeline the test kept passing while the day's capacity silently
  // stopped counting approved-but-unpapered trips. A test that restates the value
  // cannot notice the value is wrong; this one fails until someone decides which
  // side a new status belongs on.
  const HOLDS_NO_SLOT: BookingStatus[] = ["DRAFT", "WAITLIST", "CANCELLED", "DENIED", "OUTSOURCED"];

  it("holds a slot for every status that is not explicitly excluded", () => {
    const all = Object.values(BookingStatus) as BookingStatus[];
    const expected = all.filter((st) => !HOLDS_NO_SLOT.includes(st)).sort();
    expect([...SLOT_HOLDING_STATUSES].sort()).toEqual(expected);
  });

  it("excludes the statuses that are not a live claim on the day", () => {
    for (const st of HOLDS_NO_SLOT) expect(SLOT_HOLDING_STATUSES).not.toContain(st);
  });

  it("counts AWAITING_DOCUMENT — approved, merely waiting on paperwork", () => {
    expect(SLOT_HOLDING_STATUSES).toContain("AWAITING_DOCUMENT");
  });
});
