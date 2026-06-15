// CR-07 — job-type classifier.
//
// Inputs come from the booking form: the trip's start + end timestamps
// and an explicit `outOfProvince` flag (set by the requester, NOT
// inferred from the province string — see Update 2 of the change log).
//
// Output is one of TJW | OT | NORMAL. The WERN row in the supervisor's
// matrix is reserved for the daily duty driver and is never auto-emitted
// by this classifier — it's driven by the OnCallShift table instead.
// SMUS is also defined in the enum but never returned here; if the
// client later starts using it, add a branch above NORMAL.

import type { JobType } from "@prisma/client";

export const WORK_DAY_START_HOUR = 8;   // anything starting before this is OT
export const WORK_DAY_END_HOUR = 16;    // anything ending after this is OT
// A trip beyond this distance (km) needs a relief co-driver (the 2-driver rule).
// Re-exported from matching.ts and batch-solver.ts for their existing importers.
export const LONG_TRIP_KM = 400;

export interface ClassifyInput {
  startAt: Date;
  endAt: Date;
  /** Explicit requester-set flag. Greater-Bangkok metro is NOT auto-local;
   *  the strict province match is intentional per CR-07 default. */
  outOfProvince: boolean;
}

/** True if the trip crosses midnight (end is on a later calendar day). */
export function isOvernight(startAt: Date, endAt: Date): boolean {
  const startDay = ymdLocal(startAt);
  const endDay = ymdLocal(endAt);
  return endDay > startDay;
}

function ymdLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Classify a trip into one of the matcher's three auto-assigned categories.
 *
 *  - TJW    : out-of-province AND overnight (longest commitment)
 *  - OT     : overnight same-area OR start before 08:00 OR end after 16:00
 *  - NORMAL : everything else (inside the working window, same-day, local)
 *
 * The order matters: a Bangkok trip that crosses midnight is OT, not TJW,
 * even though `end.date > start.date`. The change log calls this out
 * specifically — Update 2 fixed the prior misclassification.
 */
export function classifyJobType(input: ClassifyInput): JobType {
  const overnight = isOvernight(input.startAt, input.endAt);
  if (input.outOfProvince && overnight) return "TJW";
  if (overnight) return "OT";
  if (input.startAt.getHours() < WORK_DAY_START_HOUR) return "OT";
  if (input.endAt.getHours() > WORK_DAY_END_HOUR) return "OT";
  if (input.endAt.getHours() === WORK_DAY_END_HOUR && input.endAt.getMinutes() > 0) return "OT";
  return "NORMAL";
}

/** A TJW away-day counts as a 12-hour commitment on the fairness ledger. */
export const TJW_DAY_HOURS = 12;

/** Inclusive calendar-day span of a trip (same-day = 1, Jun 9→Jun 11 = 3). */
function spanDays(startAt: Date, endAt: Date): number {
  const s = new Date(startAt);
  s.setHours(0, 0, 0, 0);
  const e = new Date(endAt);
  e.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
}

/**
 * Duration-weighted effort for the general fairness ledger, in committed hours.
 * Replaces the old coarse per-job-type weight so a multi-day TJW is credited for
 * every day the driver is away (a 3-day TJW = 36, vs a same-day TJW = 12, vs a
 * 2 h NORMAL = 2). WERN stays 0 — the duty driver is handled by its own rotation.
 */
export function tripEffort(jobType: JobType, startAt: Date, endAt: Date): number {
  if (jobType === "WERN") return 0;
  if (jobType === "TJW") return spanDays(startAt, endAt) * TJW_DAY_HOURS;
  return (endAt.getTime() - startAt.getTime()) / 3_600_000;
}
