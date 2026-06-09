import { describe, it, expect } from "vitest";
import {
  bookingHalf,
  isHalfFull,
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

describe("isHalfFull", () => {
  it("full once used reaches capacity", () => {
    expect(isHalfFull(2, 3)).toBe(false);
    expect(isHalfFull(3, 3)).toBe(true);
    expect(isHalfFull(4, 3)).toBe(true);
  });
  it("never full when no job vehicles", () => {
    expect(isHalfFull(0, 0)).toBe(false);
    expect(isHalfFull(5, 0)).toBe(false);
  });
});

describe("submitStatus", () => {
  it("guarantees within capacity, waitlists over", () => {
    expect(submitStatus(2, 3)).toBe("PENDING_APPROVAL");
    expect(submitStatus(3, 3)).toBe("WAITLIST");
  });
});

describe("dayWindow", () => {
  it("spans midnight to next midnight", () => {
    const { start, end } = dayWindow(new Date("2026-06-12T14:30:00"));
    expect(start.getHours()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
