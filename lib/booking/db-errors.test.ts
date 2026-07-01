import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { isExclusionViolation } from "@/lib/booking/db-errors";

describe("isExclusionViolation", () => {
  it("is true when Prisma exposes the PG code in meta", () => {
    const err = new Prisma.PrismaClientKnownRequestError("exclusion", {
      code: "P2010",
      clientVersion: "5",
      meta: { code: "23P01" },
    });
    expect(isExclusionViolation(err)).toBe(true);
  });
  it("is true when only the message carries the constraint name (real client shape)", () => {
    expect(isExclusionViolation(new Error('violates exclusion constraint "vehicle_occupancy_no_overlap"'))).toBe(true);
  });
  it("is false for anything else", () => {
    expect(isExclusionViolation(new Error("nope"))).toBe(false);
    expect(isExclusionViolation(null)).toBe(false);
  });
});
