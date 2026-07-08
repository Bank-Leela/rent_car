import { describe, expect, it } from "vitest";
import { buildDistanceUrl, parseDistanceKm } from "./distance";

describe("buildDistanceUrl", () => {
  it("puts destination + province + country in, origin + key set", () => {
    const url = buildDistanceUrl({ destination: "โรงพยาบาลจุฬาลงกรณ์", province: "กรุงเทพมหานคร", key: "K123" });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://maps.googleapis.com/maps/api/distancematrix/json");
    expect(u.searchParams.get("destinations")).toContain("โรงพยาบาลจุฬาลงกรณ์");
    expect(u.searchParams.get("destinations")).toContain("กรุงเทพมหานคร");
    expect(u.searchParams.get("destinations")).toContain("ประเทศไทย");
    expect(u.searchParams.get("mode")).toBe("driving");
    expect(u.searchParams.get("key")).toBe("K123");
    expect(u.searchParams.get("origins")).toBeTruthy();
  });
});

describe("parseDistanceKm", () => {
  it("rounds meters to km on OK", () => {
    const body = { status: "OK", rows: [{ elements: [{ status: "OK", distance: { value: 12650 } }] }] };
    expect(parseDistanceKm(body)).toBe(13);
  });
  it("returns null when the element/route is not OK or malformed", () => {
    expect(parseDistanceKm({ status: "OK", rows: [{ elements: [{ status: "ZERO_RESULTS" }] }] })).toBeNull();
    expect(parseDistanceKm({ status: "REQUEST_DENIED" })).toBeNull();
    expect(parseDistanceKm({ status: "OK", rows: [] })).toBeNull();
    expect(parseDistanceKm(null)).toBeNull();
    expect(parseDistanceKm("nope")).toBeNull();
  });
});
