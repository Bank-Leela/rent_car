// Pure, deterministic simulation core for the batch matcher (CR-07).
//
// Extracted from the previously-duplicated day-loop in
// scripts/simulate-driver-distribution.ts and lib/booking/solver-invariants.test.ts.
// No DB, no I/O. All randomness flows from a seeded PRNG and all dates derive
// from a fixed base date, so a given seed reproduces a run exactly (the project
// forbids Date.now() / Math.random() in this kind of code).

import type { JobType } from "@prisma/client";
import {
  solveDay,
  type SolverBookingInput,
  type SolverInput,
  type SolverOutput,
  type TjwCommitment,
} from "./batch-solver";
import { tripEffort, WORK_DAY_END_HOUR } from "./classification";
import type { DriverRotationState } from "./rotations";

const JOB_TYPES: JobType[] = ["TJW", "OT", "WERN", "NORMAL"];

/** Deterministic PRNG. Same seed → same sequence. Returns values in [0, 1). */
export function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GenerateDayOptions {
  numDrivers: number;
  /** Fraction of TJW trips that span more than one day. */
  multiDayTjwProb: number;
}

/**
 * One day's synthetic bookings. Mirrors the load profile the prior sim used,
 * plus multi-day TJW: with probability `multiDayTjwProb` a TJW trip ends on a
 * later calendar day (k ∈ 1..3) at ~14:00 or ~18:00 — a mix of before/after the
 * 16:00 return cutoff so the Phase-C return path is exercised.
 */
export function generateDay(
  rng: () => number,
  date: Date,
  opts: GenerateDayOptions,
): SolverBookingInput[] {
  const randint = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const bookings: SolverBookingInput[] = [];
  let seq = 0;
  const mk = (jobType: JobType, startAt: Date, endAt: Date, dist: number) => {
    bookings.push({
      bookingId: `${date.getTime()}-${seq}`,
      jobType,
      startAt,
      endAt,
      estimatedDistance: dist,
      outOfProvince: jobType === "TJW",
      submittedAt: new Date(date.getTime() + seq),
    });
    seq++;
  };
  const at = (h: number, dayOffset = 0) => {
    const d = new Date(date);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, 0, 0, 0);
    return d;
  };

  const counts = {
    TJW: randint(0, 2),
    OT: randint(1, 3),
    WERN: randint(0, 1),
    NORMAL: randint(2, 5),
  };

  for (let i = 0; i < counts.TJW; i++) {
    const multiDay = rng() < opts.multiDayTjwProb;
    const span = multiDay ? randint(1, 3) : 0;
    const endHour = span === 0 ? 18 : rng() < 0.5 ? 14 : 18;
    mk("TJW", at(6), at(endHour, span), randint(100, 800)); // some >400 km → secondary
  }
  for (let i = 0; i < counts.OT; i++) {
    const evening = i % 2 === 1;
    mk("OT", at(evening ? 18 : 5), at(evening ? 21 : 9), randint(20, 90));
  }
  for (let i = 0; i < counts.WERN; i++) {
    mk("WERN", at(8), at(12), 15);
  }
  for (let i = 0; i < counts.NORMAL; i++) {
    const am = i % 2 === 0;
    mk("NORMAL", at(am ? 9 : 13), at(am ? 11 : 15), randint(5, 60));
  }

  return bookings;
}

// ---- the day-loop ----

export interface SimulateOptions {
  days: number;
  seed: number;
  /** default 6 */
  numDrivers?: number;
  /** default 0.4 */
  multiDayTjwProb?: number;
  /** Per-day hook — the property test asserts invariants here. */
  onDay?: (ctx: DayContext) => void;
}

export interface DayContext {
  day: number;
  date: Date;
  dutyDriverId: string | null;
  /** TJW commitments spanning today that were passed to solveDay. */
  activeTjwCommitments: TjwCommitment[];
  input: SolverInput;
  output: SolverOutput;
  /** Driver rotation snapshot AFTER this day's stamping. */
  drivers: DriverRotationState[];
}

export interface Metrics {
  days: number;
  numDrivers: number;
  totalBookings: number;
  totalAssigned: number;
  overflowByReason: Record<string, number>;
  perDriverByType: Record<string, Record<JobType, number>>;
  earnings: Record<string, number>;
  fairness: { perType: Record<JobType, [number, number]>; gini: number };
  utilization: {
    busyDriverDays: number;
    idleDriverDays: number;
    awayDriverDays: number;
    totalDriverDays: number;
  };
  tjw: { multiDayCount: number; avgAwaySpanDays: number };
}

export interface SimulateResult {
  metrics: Metrics;
}

interface OpenCommitment extends TjwCommitment {
  spanDays: number;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** A spanning commitment that does NOT return before today's cutoff = still away. */
function isAwayToday(c: TjwCommitment, date: Date): boolean {
  const returneeToday = sameCalendarDay(c.endAt, date) && c.endAt.getHours() < WORK_DAY_END_HOUR;
  return !returneeToday;
}

function gini(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * sorted[i]!;
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

export function simulate(opts: SimulateOptions): SimulateResult {
  const numDrivers = opts.numDrivers ?? 6;
  const multiDayTjwProb = opts.multiDayTjwProb ?? 0.4;
  const rng = mulberry32(opts.seed);
  const base = new Date("2026-01-01T00:00:00");

  const drivers: DriverRotationState[] = Array.from({ length: numDrivers }, (_, i) => ({
    driverId: `D${i + 1}`,
    lastTjwAt: null,
    lastOtAt: null,
    lastDutyAt: null,
    lastAssignedAt: null,
    earningsScore: 0,
  }));

  const tally: Record<string, Record<JobType, number>> = {};
  for (const d of drivers) tally[d.driverId] = { TJW: 0, OT: 0, WERN: 0, NORMAL: 0, SMUS: 0 };

  const overflowByReason: Record<string, number> = {};
  let totalBookings = 0;
  let totalAssigned = 0;
  let busyDriverDays = 0;
  let awayDriverDays = 0;
  let multiDayCount = 0;
  let awaySpanSum = 0;

  let open: OpenCommitment[] = [];

  for (let day = 0; day < opts.days; day++) {
    const date = new Date(base);
    date.setDate(date.getDate() + day);
    const dayStart = startOfDay(date);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Drop commitments that have fully returned before today.
    open = open.filter((c) => c.endAt > dayStart);
    // Today's active commitments (prod predicate: startAt < dayEnd && endAt > dayStart).
    const activeTjwCommitments: TjwCommitment[] = open
      .filter((c) => c.startAt < dayEnd && c.endAt > dayStart)
      .map((c) => ({ driverId: c.driverId, startAt: c.startAt, endAt: c.endAt }));

    const dutyDriverId = `D${(day % numDrivers) + 1}`;
    const bookings = generateDay(rng, date, { numDrivers, multiDayTjwProb });
    totalBookings += bookings.length;
    const bookingById = new Map(bookings.map((b) => [b.bookingId, b]));

    const input: SolverInput = { date, bookings, drivers, dutyDriverId, activeTjwCommitments };
    const output = solveDay(input);

    // Stamp rotation state (mirrors batch-actions + the prior sim).
    const stamp = date;
    for (const a of output.assignments) {
      totalAssigned++;
      for (const id of [a.primaryDriverId, a.secondaryDriverId]) {
        if (!id) continue;
        tally[id]![a.jobType] += 1;
        const d = drivers.find((x) => x.driverId === id)!;
        if (a.jobType === "TJW") d.lastTjwAt = stamp;
        else if (a.jobType === "OT") d.lastOtAt = stamp;
        else if (a.jobType === "WERN") d.lastDutyAt = stamp;
        d.lastAssignedAt = stamp;
        const ab = bookingById.get(a.bookingId)!;
        d.earningsScore += tripEffort(a.jobType, ab.startAt, ab.endAt);
      }
    }
    for (const o of output.overflows) {
      overflowByReason[o.reason] = (overflowByReason[o.reason] ?? 0) + 1;
    }

    // Register new multi-day TJW assignments as future commitments.
    for (const a of output.assignments) {
      if (a.jobType !== "TJW") continue;
      const b = bookingById.get(a.bookingId)!;
      if (sameCalendarDay(b.startAt, b.endAt)) continue; // same-day TJW: solver handles within the day
      const spanDays = Math.round((startOfDay(b.endAt).getTime() - startOfDay(b.startAt).getTime()) / 86_400_000);
      multiDayCount++;
      awaySpanSum += spanDays;
      for (const id of [a.primaryDriverId, a.secondaryDriverId]) {
        if (!id) continue;
        open.push({ driverId: id, startAt: b.startAt, endAt: b.endAt, spanDays });
      }
    }

    // Utilization for the day.
    const awayIds = new Set(
      activeTjwCommitments.filter((c) => isAwayToday(c, date)).map((c) => c.driverId),
    );
    const busyIds = new Set<string>();
    for (const a of output.assignments) {
      busyIds.add(a.primaryDriverId);
      if (a.secondaryDriverId) busyIds.add(a.secondaryDriverId);
    }
    awayDriverDays += awayIds.size;
    busyDriverDays += [...busyIds].filter((id) => !awayIds.has(id)).length;

    opts.onDay?.({
      day,
      date,
      dutyDriverId,
      activeTjwCommitments,
      input,
      output,
      drivers: drivers.map((d) => ({ ...d })),
    });
  }

  const perType: Record<JobType, [number, number]> = {} as Record<JobType, [number, number]>;
  for (const jt of JOB_TYPES) {
    const vals = drivers.map((d) => tally[d.driverId]![jt]);
    perType[jt] = [Math.min(...vals), Math.max(...vals)];
  }
  const totals = drivers.map((d) => JOB_TYPES.reduce((s, jt) => s + tally[d.driverId]![jt], 0));

  const totalDriverDays = opts.days * numDrivers;
  const metrics: Metrics = {
    days: opts.days,
    numDrivers,
    totalBookings,
    totalAssigned,
    overflowByReason,
    perDriverByType: Object.fromEntries(drivers.map((d) => [d.driverId, tally[d.driverId]!])),
    earnings: Object.fromEntries(drivers.map((d) => [d.driverId, d.earningsScore])),
    fairness: { perType, gini: gini(totals) },
    utilization: {
      busyDriverDays,
      awayDriverDays,
      idleDriverDays: totalDriverDays - busyDriverDays - awayDriverDays,
      totalDriverDays,
    },
    tjw: { multiDayCount, avgAwaySpanDays: multiDayCount === 0 ? 0 : awaySpanSum / multiDayCount },
  };

  return { metrics };
}
