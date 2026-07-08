import { differenceInCalendarDays } from "date-fns";

// Pure roster-alert windows for the driver sheet's licenseExpiresAt +
// retirementYear (Thai BE). Shared by the drivers list badges and the
// dashboard alerts card so both always agree.

export type LicenseStatus = "none" | "ok" | "expiring" | "expired";
export type RetirementStatus = "none" | "ok" | "soon" | "due";

// Licenses flag amber inside this window — enough lead time to book the
// renewal appointment.
export const LICENSE_WARN_DAYS = 60;

export function toBEYear(now: Date): number {
  return now.getFullYear() + 543;
}

export function licenseStatus(expiresAt: Date | null, now: Date): LicenseStatus {
  if (!expiresAt) return "none"; // lifetime licenses store no expiry
  const days = differenceInCalendarDays(expiresAt, now);
  if (days < 0) return "expired";
  if (days <= LICENSE_WARN_DAYS) return "expiring";
  return "ok";
}

// retirementYear is the Thai BE year from the driver sheet (เกษียณ). "due" =
// that year has arrived (or passed); "soon" = next BE year, so P'Top gets a
// full year of succession lead time.
export function retirementStatus(retirementYear: number | null, now: Date): RetirementStatus {
  if (!retirementYear) return "none";
  const currentBE = toBEYear(now);
  if (retirementYear <= currentBE) return "due";
  if (retirementYear === currentBE + 1) return "soon";
  return "ok";
}
