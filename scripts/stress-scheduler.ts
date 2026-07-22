// Exhaustive stress + boundary harness for the scheduling algorithm.
//
// Two layers, both driving the REAL solver / eligibility / classifier (no
// re-implementation — we assert against the production functions):
//
//   1. Property fuzz — a big matrix of {numDrivers × longTjwProb × seed} run
//      through simulate() (multi-day TJW carried across days), asserting the
//      full rule set on EVERY day: completeness, no-overlap, canChain-legal,
//      NORMAL cap, secondary-only-on-long-trips, away-on-TJW-never-assigned,
//      returnee-is-OT-only. Far more seeds/regimes than solver-invariants.test.
//
//   2. Boundary probes — deterministic exact-edge cases that random fuzz rarely
//      lands on: classifyJobType time cutoffs (07:59/08:00, 16:00:00.000 vs
//      .001, overnight same-area vs out-of-province), canChain 2h-gap boundary
//      (120 vs 119 min), overlap touch, NORMAL cap (morning+afternoon vs two
//      mornings / straddler / third), OT cap-exemption, no-wait split legs
//      (freed middle allowed, leg overlap blocked), and the 400/401 km secondary
//      trigger through solveDay.
//
// No DB, no I/O, fully deterministic. Exit 1 on any violation/failed probe.
//
//   npx tsx scripts/stress-scheduler.ts [--days=400] [--seeds=15]

import { simulate, type DayContext } from "../lib/booking/simulation";
import { canChain } from "../lib/booking/rotations";
import {
  classifyJobType,
  WORK_DAY_END_HOUR,
  LONG_TRIP_KM,
} from "../lib/booking/classification";
import { solveDay, type SolverBookingInput } from "../lib/booking/batch-solver";
import type { DriverRotationState } from "../lib/booking/rotations";

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const DAYS = Number(argv.days ?? 400);
const SEEDS = Number(argv.seeds ?? 15);

// ---------- shared date helpers (fixed base; no Date.now) ----------
const BASE = new Date("2026-06-15T00:00:00");
const at = (h: number, m = 0, s = 0, ms = 0) => {
  const d = new Date(BASE);
  d.setHours(h, m, s, ms);
  return d;
};
const nextDay = (h: number, m = 0) => {
  const d = new Date(BASE);
  d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d;
};

// ================= Layer 1: property fuzz =================

function startOfDayMs(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r.getTime();
}
function sameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function overlaps(a: { startAt: Date; endAt: Date }, b: { startAt: Date; endAt: Date }) {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

interface Violation {
  rule: string;
  detail: string;
  regime: string;
  day: number;
}

function checkDay(ctx: DayContext, regime: string, violations: Violation[]) {
  const { date, output, input, activeTjwCommitments } = ctx;
  const push = (rule: string, detail: string) =>
    violations.push({ rule, detail, regime, day: ctx.day });

  // away / returning classification (mirrors prod predicate).
  const away = new Set<string>();
  const returning = new Set<string>();
  for (const c of activeTjwCommitments) {
    if (c.endAt.getTime() <= startOfDayMs(date)) {
      push("stale-commitment", `${c.driverId} commitment ended before today`);
    }
    const returnee = sameCalendarDay(c.endAt, date) && c.endAt.getHours() < WORK_DAY_END_HOUR;
    if (returnee) returning.add(c.driverId);
    else away.add(c.driverId);
  }
  for (const id of away) returning.delete(id);

  const dist = new Map(input.bookings.map((b) => [b.bookingId, b.estimatedDistance]));

  for (const a of output.assignments) {
    if (away.has(a.primaryDriverId))
      push("away-assigned", `${a.primaryDriverId} away-on-TJW yet primary on ${a.bookingId}`);
    if (a.secondaryDriverId && away.has(a.secondaryDriverId))
      push("away-assigned", `${a.secondaryDriverId} away-on-TJW yet secondary on ${a.bookingId}`);

    const touchesReturnee =
      returning.has(a.primaryDriverId) ||
      (a.secondaryDriverId !== null && returning.has(a.secondaryDriverId));
    if (touchesReturnee && a.jobType !== "OT")
      push("returnee-not-ot", `returnee on ${a.bookingId} but jobType=${a.jobType}`);

    if (a.secondaryDriverId !== null) {
      if ((dist.get(a.bookingId) ?? 0) <= LONG_TRIP_KM)
        push("secondary-on-short", `${a.bookingId} has secondary but dist=${dist.get(a.bookingId)}`);
      if (a.secondaryDriverId === a.primaryDriverId)
        push("secondary-eq-primary", `${a.bookingId} secondary === primary`);
    }
  }

  if (output.assignments.length + output.overflows.length !== input.bookings.length)
    push(
      "completeness",
      `assigned ${output.assignments.length} + overflow ${output.overflows.length} != ${input.bookings.length}`,
    );

  for (const [driverId, dayTrips] of output.driverDay) {
    if (dayTrips.filter((t) => t.jobType === "NORMAL").length > 2)
      push("normal-cap", `${driverId} has >2 NORMAL trips`);
    for (let i = 0; i < dayTrips.length; i++) {
      for (let j = i + 1; j < dayTrips.length; j++) {
        if (overlaps(dayTrips[i]!, dayTrips[j]!))
          push("overlap", `${driverId} double-booked (${dayTrips[i]!.jobType}/${dayTrips[j]!.jobType})`);
      }
      const rest = dayTrips.filter((_, k) => k !== i);
      if (!canChain(dayTrips[i]!, rest))
        push("illegal-chain", `${driverId} trip ${i} fails canChain vs the rest`);
    }
  }
}

function runFuzz(): { sims: number; simDays: number; violations: Violation[] } {
  const violations: Violation[] = [];
  const driverCounts = [2, 3, 6, 12];
  const tjwProbs = [0, 0.4, 1.0];
  let sims = 0;
  let simDays = 0;
  for (const numDrivers of driverCounts) {
    for (const longTjwProb of tjwProbs) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const regime = `n=${numDrivers} tjw=${longTjwProb} seed=${seed}`;
        simulate({
          days: DAYS,
          seed,
          numDrivers,
          longTjwProb,
          onDay: (ctx) => checkDay(ctx, regime, violations),
        });
        sims++;
        simDays += DAYS;
      }
    }
  }
  return { sims, simDays, violations };
}

// ================= Layer 2: boundary probes =================

interface Probe {
  name: string;
  got: unknown;
  want: unknown;
  ok: boolean;
}
const probes: Probe[] = [];
function expect(name: string, got: unknown, want: unknown) {
  probes.push({ name, got, want, ok: JSON.stringify(got) === JSON.stringify(want) });
}

function classificationProbes() {
  const oop = (start: Date, end: Date, outOfProvince: boolean) =>
    classifyJobType({ startAt: start, endAt: end, outOfProvince });
  expect("class: 09:00–11:00 local", oop(at(9), at(11), false), "NORMAL");
  expect("class: start 07:59 → OT", oop(at(7, 59), at(9), false), "OT");
  expect("class: start 08:00 → NORMAL", oop(at(8, 0), at(11), false), "NORMAL");
  expect("class: end 16:00:00.000 → NORMAL", oop(at(9), at(16, 0, 0, 0), false), "NORMAL");
  expect("class: end 16:00:00.001 → OT", oop(at(9), at(16, 0, 0, 1), false), "OT");
  expect("class: end 16:00:01 → OT", oop(at(9), at(16, 0, 1), false), "OT");
  expect("class: end 16:01 → OT", oop(at(9), at(16, 1), false), "OT");
  expect("class: end 17:00 → OT", oop(at(9), at(17), false), "OT");
  expect("class: overnight same-area → OT", oop(at(9), nextDay(14), false), "OT");
  expect("class: overnight out-of-province → TJW", oop(at(9), nextDay(14), true), "TJW");
  expect("class: same-day out-of-province → NORMAL", oop(at(9), at(11), true), "NORMAL");
}

function chainProbes() {
  const N = (start: Date, end: Date) => ({ startAt: start, endAt: end, jobType: "NORMAL" as const });
  const OT = (start: Date, end: Date) => ({ startAt: start, endAt: end, jobType: "OT" as const });

  // 2h gap boundary: OT ending 06:00, next 08:00 → exactly 120 min → allowed.
  expect("gap: exactly 120min allowed", canChain(N(at(8), at(10)), [OT(at(4), at(6))]), true);
  // OT ending 06:01, next 08:00 → 119 min → blocked.
  expect("gap: 119min blocked", canChain(N(at(8), at(10)), [OT(at(4), at(6, 1))]), false);
  // Touching edge (10:00 end == 10:00 start): no overlap but 0 gap → blocked.
  expect("gap: touching edge blocked", canChain(N(at(10), at(12)), [N(at(8), at(10))]), false);
  // Real overlap → blocked.
  expect("overlap: real overlap blocked", canChain(N(at(10), at(12)), [N(at(8), at(11))]), false);

  // NORMAL cap: 1 morning (ends ≤12) + 1 afternoon (starts ≥12), gap ok → allowed.
  expect("cap: morning+afternoon allowed", canChain(N(at(13), at(15)), [N(at(8), at(11))]), true);
  // Two mornings → blocked.
  expect("cap: two mornings blocked", canChain(N(at(10), at(11, 30)), [N(at(6), at(8))]), false);
  // Two afternoons → blocked.
  expect("cap: two afternoons blocked", canChain(N(at(17), at(19)), [N(at(13), at(15))]), false);
  // Straddler (11–13) + another → blocked.
  expect("cap: straddler+another blocked", canChain(N(at(15), at(17)), [N(at(11), at(13))]), false);
  // Third NORMAL with clean gaps → blocked by the 2-cap.
  expect(
    "cap: third NORMAL blocked",
    canChain(N(at(10), at(11)), [N(at(6), at(8)), N(at(13), at(15))]),
    false,
  );
  // OT is exempt from the cap: 2 NORMAL + an OT that keeps the gap → allowed.
  expect(
    "cap: OT exempt on top of 2 NORMAL",
    canChain(OT(at(10), at(11)), [N(at(6), at(8)), N(at(13), at(15))]),
    true,
  );

  // No-wait split legs: whole trip 08:00–20:00, legs [8–10] + [18–20], middle free.
  const split = {
    startAt: at(8),
    endAt: at(20),
    jobType: "NORMAL" as const,
    waitAtDestination: false,
    dropOffDone: at(10),
    pickupReturnTime: "18:00",
  };
  // An OT 13:00–15:00 sits in the freed middle, ≥2h from each leg, cap-exempt →
  // allowed. (The freed middle is realistically usable by OT; a 2nd NORMAL would
  // trip the morning/afternoon cap — see the next probe.)
  expect("legs: OT in freed middle allowed", canChain(OT(at(13), at(15)), [split]), true);
  // A NORMAL in the middle of an all-day split is blocked by the cap, NOT the leg
  // math: the split's whole-trip end (20:00) + a 15:00 trip = two afternoon NORMALs.
  expect("legs: NORMAL in all-day-split middle → cap blocks", canChain(N(at(13), at(15)), [split]), false);
  // A trip 09:00–11:00 overlaps leg 1 (08–10) → blocked.
  expect("legs: overlapping a leg blocked", canChain(N(at(9), at(11)), [split]), false);
  // A trip 11:00–12:00 is only 60min after leg 1 (ends 10:00) → gap blocked.
  expect("legs: <2h from a leg blocked", canChain(N(at(11), at(12)), [split]), false);
}

function secondaryBoundaryProbe() {
  // 3 fresh car-paired drivers, no duty. One long OT trip: 400 km → no secondary;
  // 401 km → secondary. Exercises the > LONG_TRIP_KM (strict) boundary in solveDay.
  const drivers: DriverRotationState[] = ["D1", "D2", "D3"].map((driverId) => ({
    driverId,
    lastTjwAt: null,
    lastOtAt: null,
    lastDutyAt: null,
    lastAssignedAt: null,
    earningsScore: 0,
  }));
  const mk = (km: number): SolverBookingInput => ({
    bookingId: `b-${km}`,
    jobType: "OT",
    startAt: at(9),
    endAt: at(11),
    estimatedDistance: km,
    outOfProvince: false,
    submittedAt: at(0),
  });
  for (const km of [400, 401]) {
    const out = solveDay({
      date: new Date(BASE),
      bookings: [mk(km)],
      drivers,
      dutyDriverId: null,
      activeTjwCommitments: [],
    });
    const a = out.assignments.find((x) => x.bookingId === `b-${km}`);
    const hasSecondary = !!(a && a.secondaryDriverId);
    expect(`secondary: ${km}km → ${km > LONG_TRIP_KM ? "needs" : "no"} co-driver`, hasSecondary, km > LONG_TRIP_KM);
  }
}

// ================= run =================

console.log(`\n=== scheduler stress harness — days=${DAYS}, seeds=${SEEDS} ===\n`);

const fuzz = runFuzz();
console.log(
  `Layer 1 — property fuzz: ${fuzz.sims} simulations × ${DAYS} days = ${fuzz.simDays.toLocaleString()} solver-days`,
);
if (fuzz.violations.length === 0) {
  console.log(`  ✓ 0 rule violations across every day of every regime\n`);
} else {
  console.log(`  ✗ ${fuzz.violations.length} violations:`);
  const byRule = new Map<string, number>();
  for (const v of fuzz.violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
  for (const [rule, n] of byRule) console.log(`     ${rule.padEnd(22)} ${n}`);
  console.log(`  first 10:`);
  for (const v of fuzz.violations.slice(0, 10))
    console.log(`     [${v.regime} day ${v.day}] ${v.rule}: ${v.detail}`);
  console.log("");
}

classificationProbes();
chainProbes();
secondaryBoundaryProbe();

const failed = probes.filter((p) => !p.ok);
console.log(`Layer 2 — boundary probes: ${probes.length - failed.length}/${probes.length} passed`);
for (const p of probes) {
  const mark = p.ok ? "✓" : "✗";
  const suffix = p.ok ? "" : `  (got ${JSON.stringify(p.got)}, want ${JSON.stringify(p.want)})`;
  console.log(`  ${mark} ${p.name}${suffix}`);
}
console.log("");

const totalFail = fuzz.violations.length + failed.length;
if (totalFail === 0) {
  console.log(`ALL CLEAR — ${fuzz.simDays.toLocaleString()} solver-days + ${probes.length} boundary probes, 0 failures.\n`);
} else {
  console.log(`FAILURES: ${fuzz.violations.length} fuzz violations + ${failed.length} probe failures.\n`);
  process.exit(1);
}
