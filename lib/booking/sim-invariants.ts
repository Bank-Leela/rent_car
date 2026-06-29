import type { JobType } from "@prisma/client";
import { legsOverlap, minLegGapMinutes, type LegSource } from "./trip-legs";

// Leg-aware invariant checker for the 30-day fuzz simulation. Given every
// driver assignment (one entry per driver per booking — a co-driver trip yields
// two entries), it verifies the scheduling rules hold on the PERSISTED result.
// Overflows are NOT checked here (they're an expected capacity outcome); a
// non-empty result means the algorithm produced an illegal schedule.

export interface AssignedTrip extends LegSource {
  bookingId: string;
  driverId: string;
  jobType: JobType;
}

export interface RuleViolation {
  type: "DOUBLE_BOOK" | "GAP_2H" | "NORMAL_CAP" | "AWAY_CONFLICT";
  detail: string;
}

// Universal 2-hour gap between any two of a driver's trips (docs/scheduling-algorithm.md).
const GAP_MIN = 120;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const isMultiDayTjw = (t: AssignedTrip) => t.jobType === "TJW" && !sameDay(t.startAt, t.endAt);

export function checkInvariants(trips: AssignedTrip[]): RuleViolation[] {
  const out: RuleViolation[] = [];

  const byDriver = new Map<string, AssignedTrip[]>();
  for (const t of trips) {
    const arr = byDriver.get(t.driverId) ?? [];
    arr.push(t);
    byDriver.set(t.driverId, arr);
  }

  for (const [driverId, ts] of byDriver) {
    // Pairwise: overlap (double-book / away-conflict) or sub-2h gap.
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const a = ts[i]!;
        const b = ts[j]!;
        if (legsOverlap(a, b)) {
          const away = isMultiDayTjw(a) || isMultiDayTjw(b);
          out.push({
            type: away ? "AWAY_CONFLICT" : "DOUBLE_BOOK",
            detail: `driver ${driverId}: ${a.bookingId} overlaps ${b.bookingId}`,
          });
        } else if (minLegGapMinutes(a, b) < GAP_MIN) {
          out.push({
            type: "GAP_2H",
            detail: `driver ${driverId}: ${a.bookingId} / ${b.bookingId} gap < ${GAP_MIN}m`,
          });
        }
      }
    }

    // NORMAL capped at 2/day (one morning + one afternoon).
    const normalByDay = new Map<string, number>();
    for (const t of ts) {
      if (t.jobType !== "NORMAL") continue;
      const d = t.startAt.toDateString();
      normalByDay.set(d, (normalByDay.get(d) ?? 0) + 1);
    }
    for (const [d, n] of normalByDay) {
      if (n > 2) out.push({ type: "NORMAL_CAP", detail: `driver ${driverId}: ${n} NORMAL on ${d}` });
    }
  }

  return out;
}
