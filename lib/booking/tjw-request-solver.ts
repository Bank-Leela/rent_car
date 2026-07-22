import { startOfDay } from "date-fns";
import { rankForRotation, type DriverRotationState } from "./rotations";
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
const overlaps = (a: Span, b: Span) => a.startAt < b.endAt && b.startAt < a.endAt;

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
  const busy = new Map<string, Span[]>();
  for (const c of input.existingCommitments) {
    const arr = busy.get(c.driverId) ?? [];
    arr.push({ startAt: c.startAt, endAt: c.endAt });
    busy.set(c.driverId, arr);
  }

  const free = (driverId: string, span: Span): boolean => {
    if (!input.driverCar.has(driverId)) return false; // car=driver: must be paired
    if (daysOf(span).some((d) => input.dutyByDay.get(d) === driverId)) return false; // duty
    return !(busy.get(driverId) ?? []).some((s) => overlaps(s, span));
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
      arr.push(span);
      busy.set(id, arr);
    }
  }
  return { assignments, overflows };
}
