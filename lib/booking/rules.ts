import { addDays, differenceInMinutes, startOfDay } from "date-fns";

// Province name for Bangkok in Thai. Used for the lead-time short list.
export const BANGKOK_PROVINCE = "กรุงเทพมหานคร";

export const LEAD_TIME_BANGKOK_DAYS = 7;
export const LEAD_TIME_OUTSIDE_DAYS = 15;

export const TWO_DRIVER_DISTANCE_KM = 400;

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
  /** "now" injected so it's testable. */
  now: Date;
};

export type LeadTimeResult =
  | { ok: true }
  | { ok: false; reason: "TOO_SOON"; minimumDays: number; minimumStartAt: Date };

/**
 * Lead time check (plan §5.2). Bangkok = ≥7d, anywhere else = ≥15d.
 * Calendar-day rule: the earliest allowed start is midnight on (today + minDays);
 * any time on that day is fine.
 */
export function checkLeadTime({ startAt, province, now }: LeadTimeInput): LeadTimeResult {
  const minDays = province === BANGKOK_PROVINCE ? LEAD_TIME_BANGKOK_DAYS : LEAD_TIME_OUTSIDE_DAYS;
  const minimumStartAt = startOfDay(addDays(now, minDays));
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
