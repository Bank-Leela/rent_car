import { describe, expect, it } from "vitest";
import { newBookingSchema } from "./schema";

const baseInput = {
  // departmentId is no longer part of the schema (locked to profile, resolved
  // server-side). A stray key here is harmless — zod strips unknowns.
  purpose: "Faculty board meeting",
  destination: "Siriraj Hospital",
  pickupLocation: "Faculty lobby",
  waitingLocation: "Hospital parking lot",
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

  it("accepts an empty Maps URL — the link is optional", () => {
    // Many trips go where the driver already goes; requiring a share link made
    // the whole form unsubmittable over a nice-to-have. Empty ⇒ undefined, so
    // nothing writes an empty string into the column.
    const result = newBookingSchema.safeParse({ ...baseInput, googleMapsUrl: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.googleMapsUrl).toBeUndefined();
  });

  it("accepts a booking with no Maps field at all", () => {
    const withoutMaps = { ...(baseInput as Record<string, unknown>) };
    delete withoutMaps.googleMapsUrl;
    expect(newBookingSchema.safeParse(withoutMaps).success).toBe(true);
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

describe("newBookingSchema no-wait split", () => {
  const noWait = {
    ...baseInput,
    // The form emits "" for no-wait ("true" for wait); z.coerce.boolean("") = false.
    waitAtDestination: "",
    dropOffDone: "2026-06-10T10:00",
    pickupReturnTime: "15:30",
    startAt: "2026-06-10T08:00",
    endAt: "2026-06-10T18:00",
  };
  it("accepts a well-ordered same-day split", () => {
    expect(newBookingSchema.safeParse(noWait).success).toBe(true);
  });
  it("rejects missing dropOffDone when not waiting", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure to omit dropOffDone from `rest`
    const { dropOffDone: _drop, ...rest } = noWait;
    expect(newBookingSchema.safeParse(rest).success).toBe(false);
  });
  it("rejects dropOffDone after pickupReturnTime", () => {
    expect(newBookingSchema.safeParse({ ...noWait, dropOffDone: "2026-06-10T16:00" }).success).toBe(false);
  });
  it("rejects a cross-day split", () => {
    expect(newBookingSchema.safeParse({ ...noWait, endAt: "2026-06-11T09:00" }).success).toBe(false);
  });
  it("ignores dropOffDone when waiting (single interval)", () => {
    expect(newBookingSchema.safeParse({ ...baseInput, waitAtDestination: "true" }).success).toBe(true);
  });
});

// A blank / unparseable end time used to throw a TypeError straight out of
// safeParse: the field-level `.min(1)` failed, so `endAt` was still the raw
// string when the object-level refinement called `.getTime()` on it. The
// requester got an HTTP 500 instead of "this field is required". Zod runs
// object-level refinements even after a field-level failure, so every
// refinement touching startAt/endAt must confirm they are really Dates.
describe("newBookingSchema — a bad end time is a validation error, never a crash", () => {
  const cases: Array<[string, string, string]> = [
    ["blank", "", "Required"],
    ["unparseable", "not-a-date", "Invalid date"],
    ["before the start", "2026-06-10T07:00", "End time must be after start time"],
  ];

  for (const [label, endAt, expected] of cases) {
    it(`reports "${expected}" when the end time is ${label}`, () => {
      // safeParse must RETURN, not throw — that is the whole point.
      const res = newBookingSchema.safeParse({ ...baseInput, endAt });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.message === expected)).toBe(true);
      }
    });
  }

  it("still accepts a well-formed end time", () => {
    expect(newBookingSchema.safeParse(baseInput).success).toBe(true);
  });
});
