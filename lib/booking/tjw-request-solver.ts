import { startOfDay } from "date-fns";
import { canChain, rankForRotation, type DriverRotationState } from "./rotations";
import type { TjwCommitment } from "./batch-solver";
import { LONG_TRIP_KM } from "./classification";

// New-algorithm variant: assign TJW (multi-day out-of-province) trips in GLOBAL
// request-date order. Pending TJW requests are sorted by createdAt (cross-day);
// each is given the fairest eligible driver via the existing rotation/fairness
// rank, and the chosen driver's stamp is provisionally bumped so the next request
// falls to the next-fairest. Only TJW uses this; OT/WERN/NORMAL stay in solveDay.
// See docs/scheduling-algorithm.md.
//
// Leg note: TJW is always multi-day (out-of-province + overnight), and the no-wait
// split is same-day-only (the booking schema refine forbids no-wait unless the
// legs are same-day). So a TJW is never split — one interval per request here, and
// no leg-awareness is needed (unlike the per-day solveDay, which does handle legs).

export interface TjwRequestInput {
  bookingId: string;
  createdAt: Date; // the request date — the ordering key
  startAt: Date;
  endAt: Date;
  estimatedDistance: number | null; // > LONG_TRIP_KM ⇒ needs a co-driver
  needsSecondaryDriver?: boolean; // admin's manual co-driver flag (distance-independent)
}

export interface TjwSolveInput {
  requests: TjwRequestInput[]; // pending APPROVED + unassigned TJW, any day
  drivers: DriverRotationState[]; // reuse the existing rotation/fairness state
  driverCar: Map<string, string>; // car=driver: only car-paired drivers dispatchable
  existingCommitments: TjwCommitment[]; // confirmed TJW (and any away-locks) — fixed
  dutyByDay: Map<number, string>; // day-midnight ms → duty driverId (excluded that day)
}

export interface TjwAssignment {
  bookingId: string;
  primaryDriverId: string;
  secondaryDriverId: string | null;
}

export interface TjwSolveResult {
  assignments: TjwAssignment[];
  overflows: { bookingId: string; reason: "NO_PRIMARY_DRIVER" | "NO_SECONDARY_DRIVER" }[];
}

type Span = { startAt: Date; endAt: Date };

/**
 * A driver's existing commitment, and whether the §4 gap applies to it.
 *
 * "trip" — a real booking. The ≥2h chaining gap applies, via canChain.
 * "block" — a synthetic whole-day marker (leave, duty). Bare overlap ONLY:
 *   these are already 00:00–24:00, and adding a 2h gap either side would
 *   silently extend a leave day two hours into both neighbouring days.
 */
type BusySpan = Span & { kind: "trip" | "block" };

// Every local-midnight day a span touches (half-open on the end, like daysSpanned).
function daysOf(span: Span): number[] {
  const out: number[] = [];
  let cur = startOfDay(span.startAt);
  const last = startOfDay(span.endAt);
  while (cur <= last) {
    const next = new Date(cur);
    next.setDate(next.getDate() + 1);
    if (span.startAt < next && span.endAt > cur) out.push(cur.getTime());
    cur = next;
  }
  return out;
}

export function solveTjwByRequest(input: TjwSolveInput): TjwSolveResult {
  const assignments: TjwAssignment[] = [];
  const overflows: TjwSolveResult["overflows"] = [];

  // Mutable rotation snapshot so provisional bumps affect later requests.
  const state = new Map(input.drivers.map((d) => [d.driverId, { ...d }]));
  // Committed spans per driver (seeded from fixed commitments; grown as we assign).
  const busy = new Map<string, BusySpan[]>();
  for (const c of input.existingCommitments) {
    const arr = busy.get(c.driverId) ?? [];
    arr.push({ startAt: c.startAt, endAt: c.endAt, kind: c.kind ?? "trip" });
    busy.set(c.driverId, arr);
  }

  const free = (driverId: string, span: Span): boolean => {
    if (!input.driverCar.has(driverId)) return false; // car=driver: must be paired
    if (daysOf(span).some((d) => input.dutyByDay.get(d) === driverId)) return false; // duty
    const mine = busy.get(driverId) ?? [];

    // Whole-day markers: overlap only, no gap. See BusySpan.
    if (mine.some((s) => s.kind === "block" && s.startAt < span.endAt && span.startAt < s.endAt)) {
      return false;
    }

    // Real trips go through canChain — the SAME predicate the solver, the
    // matcher and the reco use. This file used to ask a private `overlaps()`
    // instead, which is bare interval non-overlap: a ZERO gap where §4 requires
    // 120 minutes, universally, for every job type. A driver could be sent out
    // of province an hour after a morning job by this button, while the
    // จับคู่อัตโนมัติ button on the same booking refused them.
    //
    // No leg handling is needed: a TJW is never a no-wait trip (see the header).
    const realTrips = mine
      .filter((s) => s.kind === "trip")
      .map((s) => ({ startAt: s.startAt, endAt: s.endAt, jobType: "TJW" as const }));
    return canChain({ startAt: span.startAt, endAt: span.endAt, jobType: "TJW" }, realTrips);
  };

  const sorted = [...input.requests].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.bookingId.localeCompare(b.bookingId),
  );

  for (const r of sorted) {
    const span: Span = { startAt: r.startAt, endAt: r.endAt };
    const eligible = input.drivers
      .map((d) => state.get(d.driverId)!)
      .filter((d) => free(d.driverId, span));
    const ranked = rankForRotation(eligible, (d) => d.lastTjwAt);
    const primary = ranked[0];
    if (!primary) {
      overflows.push({ bookingId: r.bookingId, reason: "NO_PRIMARY_DRIVER" });
      continue;
    }

    let secondary: string | null = null;
    if (r.needsSecondaryDriver || (r.estimatedDistance ?? 0) > LONG_TRIP_KM) {
      const co = ranked.find((id) => id !== primary);
      if (!co) {
        overflows.push({ bookingId: r.bookingId, reason: "NO_SECONDARY_DRIVER" });
        continue;
      }
      secondary = co;
    }

    assignments.push({ bookingId: r.bookingId, primaryDriverId: primary, secondaryDriverId: secondary });
    // Provisional bump + occupancy so the next request sees the change.
    for (const id of [primary, ...(secondary ? [secondary] : [])]) {
      const d = state.get(id)!;
      d.lastTjwAt = r.startAt;
      d.earningsScore += 1; // coarse fairness nudge; authoritative stamp set on write
      const arr = busy.get(id) ?? [];
      arr.push({ ...span, kind: "trip" });
      busy.set(id, arr);
    }
  }
  return { assignments, overflows };
}
