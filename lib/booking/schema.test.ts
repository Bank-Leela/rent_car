import { describe, expect, it } from "vitest";
import { newBookingSchema } from "./schema";

const baseInput = {
  // departmentId is no longer part of the schema (locked to profile, resolved
  // server-side). A stray key here is harmless — zod strips unknowns.
  purpose: "Faculty board meeting",
  destination: "Siriraj Hospital",
  pickupLocation: "Faculty lobby",
  province: "กรุงเทพมหานคร",
  googleMapsUrl: "https://maps.app.goo.gl/abc123",
  startAt: "2026-06-10T08:00",
  endAt: "2026-06-10T12:00",
  ajarnName: "ศ. ดร. สมชาย สุขดี",
  ajarnPhone: "0812345678",
  ajarnEmail: "somchai@chula.ac.th",
  coordinatorName: "นางสาว ประสาน งานดี",
  coordinatorPhone: "0898765432",
  jobType: "OT",
  passengerCount: "4",
  passengerNotes: "",
  estimatedDistance: "",
  needsOutsourcing: "false",
  recurringWeekdays: "",
  recurringUntil: "",
};

describe("newBookingSchema ajarn fields", () => {
  it("accepts a valid ajarn block", () => {
    const result = newBookingSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
  });

  it("rejects a missing ajarn email", () => {
    const result = newBookingSchema.safeParse({ ...baseInput, ajarnEmail: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.issues.map((i) => i.path.join("."));
      expect(fieldErrors).toContain("ajarnEmail");
    }
  });

  it("rejects a malformed ajarn email", () => {
    const result = newBookingSchema.safeParse({ ...baseInput, ajarnEmail: "not-an-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.issues.map((i) => i.path.join("."));
      expect(fieldErrors).toContain("ajarnEmail");
    }
  });

  it("rejects a missing ajarn phone", () => {
    const result = newBookingSchema.safeParse({ ...baseInput, ajarnPhone: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.issues.map((i) => i.path.join("."));
      expect(fieldErrors).toContain("ajarnPhone");
    }
  });

  it("rejects a missing ajarn name", () => {
    const result = newBookingSchema.safeParse({ ...baseInput, ajarnName: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.issues.map((i) => i.path.join("."));
      expect(fieldErrors).toContain("ajarnName");
    }
  });

  it("rejects a missing coordinator name", () => {
    const result = newBookingSchema.safeParse({ ...baseInput, coordinatorName: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.issues.map((i) => i.path.join("."));
      expect(fieldErrors).toContain("coordinatorName");
    }
  });

  it("rejects a missing coordinator phone", () => {
    const result = newBookingSchema.safeParse({ ...baseInput, coordinatorPhone: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.issues.map((i) => i.path.join("."));
      expect(fieldErrors).toContain("coordinatorPhone");
    }
  });

  it("keeps an optional trip direction (tripType) and remark", () => {
    const result = newBookingSchema.safeParse({
      ...baseInput,
      tripType: "ROUND_TRIP",
      remark: "  call security gate first  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tripType).toBe("ROUND_TRIP");
      expect(result.data.remark).toBe("call security gate first");
    }
  });
});

describe("newBookingSchema googleMapsUrl", () => {
  it("accepts a shortened (non-google.com) Maps URL", () => {
    const result = newBookingSchema.safeParse({
      ...baseInput,
      googleMapsUrl: "https://maps.app.goo.gl/xyz",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty Maps URL", () => {
    const result = newBookingSchema.safeParse({ ...baseInput, googleMapsUrl: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join("."))).toContain("googleMapsUrl");
    }
  });

  it("rejects a non-URL Maps value", () => {
    const result = newBookingSchema.safeParse({ ...baseInput, googleMapsUrl: "not a url" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-http(s) scheme (javascript:) — it is rendered as an href", () => {
    const result = newBookingSchema.safeParse({
      ...baseInput,
      googleMapsUrl: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join("."))).toContain("googleMapsUrl");
    }
  });
});
