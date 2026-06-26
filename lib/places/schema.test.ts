import { describe, expect, it } from "vitest";
import { createPlaceSchema } from "./schema";

describe("createPlaceSchema", () => {
  it("accepts a place without a maps link", () => {
    const r = createPlaceSchema.safeParse({ label: "MOU uni", destination: "X Uni", province: "Bangkok" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.googleMapsUrl).toBeUndefined();
  });

  it("accepts a place with a shortened maps link", () => {
    const r = createPlaceSchema.safeParse({
      label: "X",
      destination: "X Uni",
      province: "Bangkok",
      googleMapsUrl: "https://maps.app.goo.gl/x",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a blank label", () => {
    const r = createPlaceSchema.safeParse({ label: "  ", destination: "X Uni", province: "Bangkok" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-URL maps link", () => {
    const r = createPlaceSchema.safeParse({ label: "X", destination: "X Uni", province: "Bangkok", googleMapsUrl: "nope" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-http(s) scheme (javascript:) — it is rendered as an href", () => {
    const r = createPlaceSchema.safeParse({
      label: "X",
      destination: "X Uni",
      province: "Bangkok",
      googleMapsUrl: "javascript:alert(1)",
    });
    expect(r.success).toBe(false);
  });
});
