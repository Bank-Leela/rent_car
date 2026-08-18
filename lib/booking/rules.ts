import { addBusinessDays, addDays, differenceInMinutes, startOfDay } from "date-fns";
import { LONG_TRIP_KM } from "./classification";

// Province name for Bangkok in Thai. Used for the lead-time short list.
export const BANGKOK_PROVINCE = "กรุงเทพมหานคร";

export const LEAD_TIME_BANGKOK_DAYS = 3;
export const LEAD_TIME_OUTSIDE_DAYS = 7;
// External charter (SMUS — "หลักสูตรนิสิตแพทย์"): booked from outside vendors,
// so it needs a much longer lead time. Counted in calendar days (weekends
// included), unlike the other two tiers which skip Sat/Sun.
export const LEAD_TIME_SMUS_DAYS = 30;
// Urgent ("จองเร่งด่วน") requests waive the normal lead time down to this
// floor. They are also excluded from auto-assign so an admin handles them by
// hand (lib/booking/batch-actions.ts).
// Zero, not one: "จองเร่งด่วน" is the ผอ ringing up on the morning they need the
// car, and a one-business-day floor made the earliest possible urgent trip
// TOMORROW — which is precisely the request it exists to serve, refused. The
// day itself is still the floor, so yesterday stays blocked for everyone but an
// admin holding the backdate override (see allowPast).
export const LEAD_TIME_URGENT_DAYS = 0;

// The >400 km "needs a co-driver" threshold has one source of truth:
// classification.ts's LONG_TRIP_KM. Re-exported under the rules-domain name so
// the assign side and the validation/display side can never drift apart.
export const TWO_DRIVER_DISTANCE_KM = LONG_TRIP_KM;

// Minimum gap (minutes) between two confirmed bookings on the same vehicle.
export const VEHICLE_BUFFER_MINUTES = 60;

// Driver standard work hours (local time). Trips that start before, end
// after, or run overnight require an out-of-hours justification.
export const WORK_START_HOUR = 7;
export const WORK_END_HOUR = 18;

export type WorkHoursInput = { startAt: Date; endAt: Date };

export function isWithinWorkHours({ startAt, endAt }: WorkHoursInput): boolean {
  // Same calendar date — overnight trips never qualify.
  const sameDay =
    startAt.getFullYear() === endAt.getFullYear() &&
    startAt.getMonth() === endAt.getMonth() &&
    startAt.getDate() === endAt.getDate();
  if (!sameDay) return false;
  const startMinute = startAt.getHours() * 60 + startAt.getMinutes();
  const endMinute = endAt.getHours() * 60 + endAt.getMinutes();
  return startMinute >= WORK_START_HOUR * 60 && endMinute <= WORK_END_HOUR * 60;
}

export type LeadTimeInput = {
  startAt: Date;
  province: string;
  /** Urgent requests collapse the lead time to LEAD_TIME_URGENT_DAYS. */
  urgent?: boolean;
  /** External charter (SMUS) gets its own 30-calendar-day floor. */
  jobType?: string | null;
  /**
   * Waive the floor entirely — a booking being RECORDED after the trip already
   * happened. The dean's office routinely sends the paper form in days late,
   * and until this existed there was no way to enter one at all. ADMIN-only,
   * and the caller is responsible for proving that: nothing here checks a role.
   */
  allowPast?: boolean;
  /** "now" injected so it's testable. */
  now: Date;
};

export type LeadTimeResult =
  | { ok: true }
  | { ok: false; reason: "TOO_SOON"; minimumDays: number; minimumStartAt: Date };

/**
 * Lead time check (plan §5.2). Bangkok/within-Chula = ≥3 business days,
 * upcountry = ≥7 business days, urgent = same day (waives the above), external
 * charter (SMUS) = ≥30 calendar days (weekends included — outside vendors
 * need the longer, uninterrupted runway). The business-day tiers skip
 * Saturdays and Sundays; the SMUS tier counts every day. The earliest allowed
 * start is midnight on that day; any time on it is fine.
 */
export function checkLeadTime({ startAt, province, urgent, jobType, now, allowPast }: LeadTimeInput): LeadTimeResult {
  // A backdated record is not a request for a future trip, so no floor applies.
  if (allowPast) return { ok: true };
  if (!urgent && jobType === "SMUS") {
    const minimumStartAt = startOfDay(addDays(now, LEAD_TIME_SMUS_DAYS));
    if (startAt.getTime() < minimumStartAt.getTime()) {
      return { ok: false, reason: "TOO_SOON", minimumDays: LEAD_TIME_SMUS_DAYS, minimumStartAt };
    }
    return { ok: true };
  }
  const minDays = urgent
    ? LEAD_TIME_URGENT_DAYS
    : province === BANGKOK_PROVINCE
      ? LEAD_TIME_BANGKOK_DAYS
      : LEAD_TIME_OUTSIDE_DAYS;
  const minimumStartAt = startOfDay(addBusinessDays(now, minDays));
  if (startAt.getTime() < minimumStartAt.getTime()) {
    return { ok: false, reason: "TOO_SOON", minimumDays: minDays, minimumStartAt };
  }
  return { ok: true };
}

export type DriverRuleInput = {
  estimatedDistance: number | null | undefined;
  primaryDriverId: string | null | undefined;
  secondaryDriverId: string | null | undefined;
};

export type DriverRuleResult =
  | { ok: true }
  | { ok: false; reason: "PRIMARY_REQUIRED" | "SECONDARY_REQUIRED" | "DUPLICATE_DRIVER" };

/**
 * Two-driver rule (plan §5.4). >400 km requires both primary and secondary,
 * and they must be distinct.
 */
export function checkDriverAssignment({
  estimatedDistance,
  primaryDriverId,
  secondaryDriverId,
}: DriverRuleInput): DriverRuleResult {
  if (!primaryDriverId) return { ok: false, reason: "PRIMARY_REQUIRED" };
  const needsSecondary =
    typeof estimatedDistance === "number" && estimatedDistance > TWO_DRIVER_DISTANCE_KM;
  if (needsSecondary && !secondaryDriverId) {
    return { ok: false, reason: "SECONDARY_REQUIRED" };
  }
  if (secondaryDriverId && secondaryDriverId === primaryDriverId) {
    return { ok: false, reason: "DUPLICATE_DRIVER" };
  }
  return { ok: true };
}

export type Window = { startAt: Date; endAt: Date };

/**
 * Buffer rule (plan §5.3). Two windows on the same vehicle must be at least
 * VEHICLE_BUFFER_MINUTES apart edge-to-edge. Overlap also fails.
 */
export function hasBufferConflict(a: Window, b: Window): boolean {
  // Overlap
  if (a.startAt < b.endAt && b.startAt < a.endAt) return true;
  // Gap (edge-to-edge)
  const gap = a.startAt > b.endAt
    ? differenceInMinutes(a.startAt, b.endAt)
    : differenceInMinutes(b.startAt, a.endAt);
  return gap < VEHICLE_BUFFER_MINUTES;
}

export function findBufferConflicts(
  candidate: Window,
  existing: Array<{ id: string } & Window>,
): Array<{ id: string } & Window> {
  return existing.filter((booking) => hasBufferConflict(candidate, booking));
}

/**
 * Cancellation warning threshold (plan §5.8). 3+ cancellations in the past 90 days.
 * This is a *warning* shown to the admin — never an auto-block.
 */
export function shouldWarnAboutCancellations(cancellationsInWindow: number): boolean {
  return cancellationsInWindow >= 3;
}

/**
 * Evaluation gating (plan §5.9). If the requester has any COMPLETED trip
 * without a submitted Evaluation, they cannot submit a new booking.
 */
export function isBlockedByPendingEvaluation(unevaluatedCompletedTrips: number): boolean {
  return unevaluatedCompletedTrips > 0;
}

export type DepartmentAuthInfo = {
  representativeUserId: string | null;
};

export type UserAuthInfo = {
  id: string;
  roles: Array<{ role: string }>;
};

/**
 * Change request 01: only the designated department representative (or an
 * admin) may submit a booking for a given department.
 */
export function canSubmitForDepartment(
  user: UserAuthInfo,
  department: DepartmentAuthInfo,
): boolean {
  if (user.roles.some((r) => r.role === "ADMIN")) return true;
  return department.representativeUserId !== null && user.id === department.representativeUserId;
}
