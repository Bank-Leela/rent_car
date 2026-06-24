import { z } from "zod";

const datetimeLocal = z
  .string()
  .min(1, "Required")
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

export const newBookingSchema = z
  .object({
    // departmentId is no longer submitted by the form: it is locked to the
    // requester's own profile department and resolved server-side.
    purpose: z.string().min(3, "Describe the trip purpose"),
    destination: z.string().min(2, "Required"),
    province: z.string().min(2, "Required"),
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
    outsideChula: z.coerce.boolean().optional().default(false),
    outOfHoursReason: z
      .string()
      .max(1000)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v.trim() : undefined)),
    passengerCount: z.coerce.number().int().min(1).max(60),
    passengerNotes: z.string().max(2000).optional().or(z.literal("")).transform((v) => v || undefined),
    estimatedDistance: z.coerce
      .number()
      .int()
      .nonnegative()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v === "" || v === undefined ? undefined : Number(v))),
    needsOutsourcing: z.coerce.boolean().optional().default(false),
    isEmergency: z.coerce.boolean().optional().default(false),
    emergencyReason: z
      .string()
      .max(1000)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v.trim() : undefined)),
    maleCount: z.coerce
      .number()
      .int()
      .nonnegative()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v === "" || v === undefined ? undefined : Number(v))),
    femaleCount: z.coerce
      .number()
      .int()
      .nonnegative()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v === "" || v === undefined ? undefined : Number(v))),
    pickupLocation: z
      .string()
      .max(500)
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v.trim() : undefined)),
    preferredVehicleId: z
      .string()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : undefined)),
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
  .refine((data) => data.endAt.getTime() > data.startAt.getTime(), {
    path: ["endAt"],
    message: "End time must be after start time",
  });

export type NewBookingInput = z.infer<typeof newBookingSchema>;

// CR-02: admin now only allocates the vehicle. Drivers self-claim their
// roles on the driver schedule board.
export const assignBookingSchema = z.object({
  bookingId: z.string().min(1),
  vehicleId: z.string().min(1, "Pick a vehicle"),
});

export const claimBookingSchema = z.object({
  bookingId: z.string().min(1),
  role: z.enum(["PRIMARY", "SECONDARY"]),
});

export const releaseClaimSchema = z.object({
  bookingId: z.string().min(1),
});

export const confirmScheduleSchema = z.object({
  bookingId: z.string().min(1),
});

export const denyBookingSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().min(3, "Reason is required"),
});

// CR-05: server action input for the matcher.
export const matchBookingSchema = z.object({
  bookingId: z.string().min(1),
});

export const updateBookingTimeSchema = z.object({
  bookingId: z.string().min(1),
  startAt: datetimeLocal,
  endAt: datetimeLocal,
  outOfHoursReason: z
    .string()
    .max(1000)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.trim() : undefined)),
});
