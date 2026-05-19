import { z } from "zod";

const datetimeLocal = z
  .string()
  .min(1, "Required")
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

export const newBookingSchema = z
  .object({
    departmentId: z.string().min(1, "Pick a department"),
    purpose: z.string().min(3, "Describe the trip purpose"),
    destination: z.string().min(2, "Required"),
    province: z.string().min(2, "Required"),
    startAt: datetimeLocal,
    endAt: datetimeLocal,
    ajarnName: z.string().trim().min(2, "Ajarn name is required"),
    ajarnPhone: z.string().trim().min(6, "Ajarn phone is required"),
    ajarnEmail: z.string().trim().email("Invalid email address"),
    jobTier: z
      .enum(["INTERNATIONAL", "SCHOOL", "PROVINCIAL", "ON_CALL"])
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? v : undefined)),
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
      .transform((v) => (v ? new Date(v) : undefined)),
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
