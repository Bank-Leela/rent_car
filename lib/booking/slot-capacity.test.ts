import { describe, it, expect } from "vitest";
import {
  bookingHalf,
  dayCapacity,
  isFull,
  submitStatus,
  dayWindow,
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
});
