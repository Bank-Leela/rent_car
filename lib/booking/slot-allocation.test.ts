import { describe, expect, it } from "vitest";
import { bucketFromStart } from "./slot-allocation";

describe("bucketFromStart", () => {
  it("maps the four ranges", () => {
    expect(bucketFromStart(new Date("2026-06-10T07:30:00"))).toBe("BEFORE_08");
    expect(bucketFromStart(new Date("2026-06-10T08:00:00"))).toBe("MORNING_08_12");
    expect(bucketFromStart(new Date("2026-06-10T11:59:00"))).toBe("MORNING_08_12");
    expect(bucketFromStart(new Date("2026-06-10T12:00:00"))).toBe("AFTERNOON_12_16");
    expect(bucketFromStart(new Date("2026-06-10T15:59:00"))).toBe("AFTERNOON_12_16");
    expect(bucketFromStart(new Date("2026-06-10T16:00:00"))).toBe("AFTER_16");
    expect(bucketFromStart(new Date("2026-06-10T22:00:00"))).toBe("AFTER_16");
  });
});
