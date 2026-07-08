import { describe, expect, it } from "vitest";
import { addDays, subDays } from "date-fns";
import { licenseStatus, retirementStatus, toBEYear } from "./roster-alerts";

const NOW = new Date("2026-07-08T10:00:00");

describe("toBEYear", () => {
  it("converts CE to Thai Buddhist Era (+543)", () => {
    expect(toBEYear(NOW)).toBe(2569);
    expect(toBEYear(new Date("2027-01-01T00:00:00"))).toBe(2570);
  });
});

describe("licenseStatus", () => {
  it("is none without an expiry (lifetime licenses)", () => {
    expect(licenseStatus(null, NOW)).toBe("none");
  });
  it("is ok when expiry is beyond the 60-day window", () => {
    expect(licenseStatus(addDays(NOW, 61), NOW)).toBe("ok");
  });
  it("is expiring within 60 days (boundary included)", () => {
    expect(licenseStatus(addDays(NOW, 60), NOW)).toBe("expiring");
    expect(licenseStatus(addDays(NOW, 1), NOW)).toBe("expiring");
  });
  it("is expired once the date has passed", () => {
    expect(licenseStatus(subDays(NOW, 1), NOW)).toBe("expired");
  });
});

describe("retirementStatus", () => {
  it("is none without a retirement year", () => {
    expect(retirementStatus(null, NOW)).toBe("none");
  });
  it("is due in (or past) the retirement year — 2569 is this BE year", () => {
    expect(retirementStatus(2569, NOW)).toBe("due");
    expect(retirementStatus(2568, NOW)).toBe("due");
  });
  it("is soon exactly one BE year out", () => {
    expect(retirementStatus(2570, NOW)).toBe("soon");
  });
  it("is ok further out", () => {
    expect(retirementStatus(2571, NOW)).toBe("ok");
    expect(retirementStatus(2581, NOW)).toBe("ok");
  });
});
