import { z } from "zod";

// Mirrors prisma's PreferredVehicleType enum. Requester's preferred vehicle
// CATEGORY — informational only, does not drive assignment.
export const PREFERRED_VEHICLE_TYPES = [
  "VAN",
  "TRUCK_6_WHEEL",
  "PICKUP",
  "SEDAN_DEAN",
  "BUS_OUTSOURCED",
] as const;
const preferredVehicleType = z.enum(PREFERRED_VEHICLE_TYPES).default("VAN");

const datetimeLocal = z
  .string()
  .min(1, "Required")
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

/**
 * An optional number from an HTML form, where "left blank" must stay blank.
 *
 * The shape this replaces looked right and was not:
 *
 *   z.coerce.number().nonnegative().optional().or(z.literal(""))
 *     .transform((v) => (v === "" || v === undefined ? undefined : Number(v)))
 *
 * A union tries its branches in order, and in zod 4 the FIRST branch already
 * accepts "": `z.coerce.number()` runs `Number("")`, which is **0**, and 0 is a
 * nonnegative number, so the parse succeeds there. `z.literal("")` is never
 * reached and the transform receives 0, not "". Verified against this repo's
 * zod 4.4.3: `safeParse("")` → `{ success: true, data: 0 }`.
 *
 * The consequence was silent and on paper: a driver who bought no fuel left the
 * boxes empty and the trip was written with fuelCost 0, tollwayCost 0,
 * parkingCost 0 — and the official form that gets printed, signed and filed
 * then asserted ค่าน้ำมัน 0 instead of leaving the box blank.
 *
 * `preprocess` runs BEFORE any branch, so the empty string is turned into
 * `undefined` while it still is an empty string.
 */
export const optionalNumber = (opts?: { int?: boolean; min?: number; max?: number }) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    (() => {
      let n = z.coerce.number();
      if (opts?.int) n = n.int();
      n = n.min(opts?.min ?? 0);
      if (opts?.max !== undefined) n = n.max(opts.max);
      return n.optional();
    })(),
  );

// True only when both timestamps survived their field-level parse as real Dates.
const bothDates = (d: { startAt: unknown; endAt: unknown }): d is { startAt: Date; endAt: Date } =>
  d.startAt instanceof Date && d.endAt instanceof Date;

export const newBookingSchema = z
  .object({
    // departmentId is no longer submitted by the form: it is locked to the
    // requester's own profile department and resolved server-side.
    purpose: z.string().min(3, "Describe the trip purpose"),
    destination: z.string().min(2, "Required"),
    province: z.string().min(2, "Required"),
    // Sub-project A: stored Maps link. OPTIONAL — plenty of trips go to a place
    // the driver already knows (in-campus rounds, the usual hospitals), and
    // making every requester hunt for a share link to submit at all was a wall
    // in front of the form. Any host, so maps.app.goo.gl / goo.gl/maps
    // shortened links work. No distance pull.
    //
    // Still validated WHEN GIVEN, and http(s) only: the value is rendered as a
    // clickable href elsewhere, so a javascript:/data: scheme (which z.url()
    // would accept) must be rejected. Empty ⇒ undefined, not "".
    googleMapsUrl: z
      .string()
      .trim()
      .url("Add a valid Google Maps link")
      .refine((v) => /^https?:\/\//i.test(v), "Add a valid Google Maps link")
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : undefined)),
    startAt: datetimeLocal,
    endAt: datetimeLocal,
    // "ผู้ขอใช้รถ" — the requester/secretary who submits on the ajarn's behalf.
    // Column names kept as ajarn* for back-compat; labels relabel them.
    ajarnName: z.string().trim().min(2, "Requester name is required"),
    ajarnPhone: z.string().trim().min(6, "Requester phone is required"),
    ajarnEmail: z.string().trim().email("Invalid email address"),
    // "ผู้ประสานงาน" — the coordination contact for the trip.
    coordinatorName: z.string().trim().min(2, "Coordinator name is required"),
    coordinatorPhone: z.string().trim().min(6, "Coordinator phone is required"),
    tripType: z
      .enum(["ROUND_TRIP", "DROP_OFF", "PICK_UP_DROP_OFF"])
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : undefined)),
    remark: z
      .string()
      .max(2000)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v.trim() : undefined)),
    // CR-07: jobType is no longer picked by the requester. The classifier
    // (lib/booking/classification.ts) derives it from startAt/endAt +
    // outOfProvince. Field is optional here for back-compat with older
    // tooling; createBookingAction computes it.
    jobType: z
      .enum(["TJW", "OT", "WERN", "NORMAL", "SMUS"])
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : undefined)),
    outOfProvince: z.coerce.boolean().optional().default(false),
    // When true: trip stays on the Chula campus, asking for the duty (รถเวร)
    // vehicle. createBookingAction forces jobType=WERN for these.
    travelWithinChula: z.coerce.boolean().optional().default(false),
    outOfHoursReason: z
      .string()
      .max(1000)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v.trim() : undefined)),
    passengerCount: z.coerce.number().int().min(1).max(60),
    passengerNotes: z.string().max(2000).optional().or(z.literal("")).transform((v) => v || undefined),
    estimatedDistance: optionalNumber({ int: true }),
    needsOutsourcing: z.coerce.boolean().optional().default(false),
    isEmergency: z.coerce.boolean().optional().default(false),
    emergencyReason: z
      .string()
      .max(1000)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v.trim() : undefined)),
    maleCount: optionalNumber({ int: true }),
    femaleCount: optionalNumber({ int: true }),
    pickupLocation: z.string().trim().min(1, "Pickup point is required").max(500),
    // One-way ("ไม่เดินทางกลับ"): the requester leaves the end time to the admin.
    // The form still sends a provisional endAt so the data model stays simple;
    // the admin sets the real one at approval.
    returnTrip: z.coerce.boolean().optional().default(true),
    // Independent of pickupReturnTime — neither field gates the other.
    waitAtDestination: z.coerce.boolean().optional().default(true),
    pickupReturnTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time")
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : undefined)),
    // Where the vehicle parks/waits near the destination. Required only when the
    // car waits (see the cross-field refine below) — a no-wait trip has none.
    waitingLocation: z.string().trim().max(500).optional(),
    // No-wait split: end of leg 1 (datetime-local). Required + ordered when
    // waitAtDestination = false (see the cross-field refine below).
    dropOffDone: z
      .string()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? new Date(v) : undefined))
      .refine((d) => d === undefined || !Number.isNaN(d.getTime()), "Invalid drop-off time"),
    preferredVehicleType,
    // External charter (SMUS) vehicle counts — outside buses/vans. Optional in
    // general; the SMUS refinement below requires a non-zero total.
    externalBusCount: optionalNumber({ int: true, max: 99 }),
    externalVanCount: optionalNumber({ int: true, max: 99 }),
    recurringWeekdays: z
      .string()
      .optional()
      .or(z.literal(""))
      .transform((v) => {
        if (!v) return [] as number[];
        return v
          .split(",")
          .map((s) => Number.parseInt(s.trim(), 10))
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      }),
    recurringUntil: z
      .string()
      .optional()
      .or(z.literal(""))
      .transform((v) => {
        if (!v) return undefined;
        // A date-only value ("yyyy-MM-dd") would parse as UTC midnight; coerce
        // it to LOCAL midnight so it lines up with the local startAt when the
        // recurrence is expanded.
        const s = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v;
        return new Date(s);
      }),
  })
  // Zod still runs object-level refinements when a FIELD-level check failed, so
  // startAt/endAt can still be the raw submitted string here (a blank end time
  // fails `.min(1)` and never reaches the Date transform). Calling .getTime() on
  // a string threw a TypeError out of safeParse, turning "you left the time
  // blank" into an HTTP 500. Every refinement below that touches these two must
  // therefore check they really are Dates, and defer to the field-level error.
  .refine((data) => !bothDates(data) || data.endAt.getTime() > data.startAt.getTime(), {
    path: ["endAt"],
    message: "End time must be after start time",
  })
  // External charter books outside vehicles by count, so "zero of each" is not
  // a bookable request.
  .refine(
    (data) =>
      data.jobType !== "SMUS" ||
      (data.externalBusCount ?? 0) + (data.externalVanCount ?? 0) >= 1,
    {
      path: ["externalBusCount"],
      message: "Specify at least one bus or van",
    },
  )
  // No-wait split must be a same-day, well-ordered pair of legs:
  // startAt < dropOffDone < pickupReturnTime < endAt.
  .refine(
    (d) => {
      if (!bothDates(d)) return true; // field-level error already reported
      if (d.waitAtDestination) return true;
      if (!d.dropOffDone || !d.pickupReturnTime) return false;
      const [h, m] = d.pickupReturnTime.split(":").map(Number);
      const ret = new Date(d.startAt);
      ret.setHours(h, m, 0, 0);
      const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
      return (
        d.startAt < d.dropOffDone &&
        d.dropOffDone < ret &&
        ret < d.endAt &&
        sameDay(d.startAt, d.dropOffDone) &&
        sameDay(d.startAt, d.endAt)
      );
    },
    {
      path: ["dropOffDone"],
      message: "No-wait trips need start < drop-off < return < end, same day",
    },
  )
  // Waiting location only applies when the car waits at the destination; a
  // no-wait trip drops off and returns, so it has none.
  .refine((d) => !d.waitAtDestination || (d.waitingLocation?.trim().length ?? 0) > 0, {
    path: ["waitingLocation"],
    message: "Waiting location is required",
  });

export type NewBookingInput = z.infer<typeof newBookingSchema>;

// A saved trip template: a named snapshot of the booking form minus the
// dates/recurrence. Fields are lenient (a template may be partially filled);
// the booking form re-validates on actual submit.
// Same empty-string trap as optionalNumber (see its comment), but a template
// field stores null rather than leaving the key out.
const optInt = optionalNumber({ int: true }).transform((v) => v ?? null);
const optStr = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.trim() : null));

export const tripTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  purpose: z.string().max(500).optional().default(""),
  destination: z.string().max(500).optional().default(""),
  // Plain optional string here (not a strict URL): the booking form re-validates
  // googleMapsUrl on submit; the template just snapshots whatever was typed.
  googleMapsUrl: optStr(2000),
  province: z.string().max(120).optional().default(""),
  pickupLocation: optStr(500),
  returnTrip: z.coerce.boolean().optional().default(true),
  waitingLocation: optStr(500),
  passengerCount: z.coerce.number().int().min(1).max(60).optional().default(1),
  maleCount: optInt,
  femaleCount: optInt,
  passengerNotes: optStr(2000),
  ajarnName: z.string().max(200).optional().default(""),
  ajarnPhone: z.string().max(50).optional().default(""),
  ajarnEmail: z.string().max(200).optional().default(""),
  coordinatorName: z.string().max(200).optional().default(""),
  coordinatorPhone: z.string().max(50).optional().default(""),
  preferredVehicleType,
  outOfProvince: z.coerce.boolean().optional().default(false),
  travelWithinChula: z.coerce.boolean().optional().default(false),
  needsOutsourcing: z.coerce.boolean().optional().default(false),
  isEmergency: z.coerce.boolean().optional().default(false),
});

export type TripTemplateInput = z.infer<typeof tripTemplateSchema>;

export const renameTripTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(120),
});

export const deleteTripTemplateSchema = z.object({ id: z.string().min(1) });

// CR-02: admin now only allocates the vehicle. Drivers self-claim their
// roles on the driver schedule board.
export const assignBookingSchema = z.object({
  bookingId: z.string().min(1),
  vehicleId: z.string().min(1, "Pick a vehicle"),
});

export const denyBookingSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().min(3, "Reason is required"),
});

// CR-05: server action input for the matcher.
export const matchBookingSchema = z.object({
  bookingId: z.string().min(1),
});
