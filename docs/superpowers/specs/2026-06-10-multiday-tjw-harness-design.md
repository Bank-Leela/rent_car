# Design: Honest multi-day-TJW simulation harness + correctness

Date: 2026-06-10
Status: Approved (brainstorming) — pending implementation plan
Scope: matching/scheduling subsystem (`lib/booking/batch-solver.ts` and its
simulators/tests). This is **sub-project A+B** of a larger matching-algorithm
improvement effort. C (effort-weighted fairness) and D (overflow reduction) are
separate specs and out of scope here.

---

## 1. Problem

The batch solver (`solveDay`) supports multi-day, out-of-province **TJW** trips:
a driver assigned a TJW that spans several days is locked away (`awayOnTjw`)
until they return, and a driver returning before the 16:00 cutoff is eligible
only for evening OT via Phase C. Production wires this correctly —
`lib/booking/batch-actions.ts:84-98` queries TJW bookings that span the target
day and passes them to `solveDay` as `activeTjwCommitments`.

But **nothing exercises that path off-database**:

- `scripts/simulate-driver-distribution.ts` and `lib/booking/solver-invariants.test.ts`
  both call `solveDay({ ..., activeTjwCommitments: [] })` — they never model a
  TJW that lasts more than one day. The sim's ~16% `NO_PRIMARY` overflow is
  therefore measured against a world where TJW trips magically vanish at
  midnight. It is not a trustworthy number.
- The two files also contain a **near-identical** copy-pasted day-loop
  (`mulberry32` PRNG, per-day booking generation, rotation-state carry). The
  multi-day logic would have to be added twice and kept in sync.

We cannot tune overflow (D) or fairness (C) against an instrument that lies
about driver availability. Fix the instrument first, and make multi-day TJW
behaviour a continuously verified invariant rather than untested code.

## 2. Goals

- **A — measurement instrument.** A simulator that models multi-day TJW and
  reports overflow-by-cause, fairness spread, driver utilization, and TJW
  away-time, so later work (C, D) has honest numbers.
- **B — correctness.** Cross-day TJW behaviour (`awayOnTjw`, return-day Phase-C
  eligibility, secondary-driver locking) is asserted on every fuzzed day in CI;
  any real solver bug the fuzz surfaces is fixed.
- Remove the duplicated day-loop by extracting one shared, pure simulation core.

## 3. Non-goals (YAGNI)

- No change to assignment logic for the purpose of reducing overflow — that is
  sub-project **D**.
- No change to the fairness weighting (`JOB_WEIGHT`) or window — that is
  sub-project **C**.
- No new DB schema, no production code path changes, except a **minimal
  correctness fix** in `batch-solver.ts` *if and only if* the fuzz surfaces a
  genuine multi-day-TJW bug (see §8).
- No UI, no metrics persistence — the harness prints to stdout / asserts in
  tests only.

## 4. Architecture — shared core, two thin consumers

New pure module **`lib/booking/simulation.ts`** (no DB, no I/O, deterministic;
obeys the project rule that `Date.now()`/`Math.random()` are not used — all
randomness flows from a seeded PRNG, all dates derive from a fixed base date):

```ts
// PRNG (lifted from the two duplicated copies)
export function mulberry32(seed: number): () => number;

// One day's synthetic bookings, including multi-day TJW trips.
export function generateDay(
  rng: () => number,
  date: Date,
  opts: { numDrivers: number; multiDayTjwProb: number },
): SolverBookingInput[];

// The day-loop: carries rotation state AND open TJW commitments across days.
export function simulate(opts: SimulateOptions): SimulateResult;

export interface SimulateOptions {
  days: number;
  seed: number;
  numDrivers?: number;        // default 6
  multiDayTjwProb?: number;   // default 0.4 (fraction of TJW trips that span >1 day)
  onDay?: (ctx: DayContext) => void; // per-day hook (the test asserts here)
}

export interface DayContext {
  day: number;                       // 0-based index
  date: Date;
  dutyDriverId: string | null;
  activeTjwCommitments: TjwCommitment[]; // what was passed to solveDay this day
  input: SolverInput;
  output: SolverOutput;              // assignments + overflows + driverDay
  drivers: DriverRotationState[];    // snapshot AFTER this day's stamping
}

export interface SimulateResult {
  metrics: Metrics;
}
```

Consumers shrink to glue:

- **`lib/booking/solver-invariants.test.ts`** →
  `simulate({ days: 500, seed: 7, onDay: assertInvariants })`. The callback
  asserts the §6 invariants for that day; the test still also makes a few
  run-level assertions (see §6.3).
- **`scripts/simulate-driver-distribution.ts`** →
  `const { metrics } = simulate({ days: 1000, seed: 42 })` then formats and
  prints `metrics` (the §7 report).

Both files drop their private `mulberry32` + day-loop copies.

## 5. The multi-day TJW model (heart of B)

**Generator (`generateDay`).** TJW trips are produced as before (06:00 start,
`outOfProvince: true`, distance `randint(100, 800)` so ~57% exceed the 400 km
secondary threshold) with one change: with probability `multiDayTjwProb` a TJW
trip is multi-day — `endAt` falls on day `D + k` (k ∈ 1..3) at ~14:00 or ~18:00
(mix of before/after the 16:00 cutoff so the return-day Phase-C path is
exercised). OT / WERN / NORMAL generation is unchanged from today's sim.

**Day-loop commitment tracking (`simulate`)** mirrors
`batch-actions.ts:84-98` exactly so the harness tests the real production
semantics. Maintain a list of *open* TJW assignments `{ driverId, startAt,
endAt }`. For each day:

1. `activeTjwCommitments` = open TJW where `startAt < dayEnd && endAt > dayStart`
   (prod's predicate verbatim).
2. `out = solveDay({ date, bookings, drivers, dutyDriverId, activeTjwCommitments })`.
3. Stamp rotation state from `out.assignments` (lastTjwAt/lastOtAt/lastDutyAt,
   `lastAssignedAt`, `earningsScore += JOB_WEIGHT[jobType]`) — primary and
   secondary, identical to today's sim and to `batch-actions` stamping.
4. For each new TJW assignment whose `endAt` is on a later day, push **both the
   primary and the secondary** driver to the open list (prod adds both —
   `batch-actions.ts:96-97`).
5. Prune open commitments whose `endAt` is before `dayStart` (returned).

Duty driver rotates daily (`D{day % numDrivers + 1}`), unchanged.

## 6. Correctness invariants (B)

### 6.1 Per-day, asserted in `onDay`

For the day's `ctx`, derive the set of drivers who are *away* (have an active
TJW commitment spanning today whose `endAt` is **not** before the 16:00 cutoff
today) and the set of *return-day* drivers (commitment `endAt` is today, before
16:00):

1. **Away means away.** No away driver appears in any `ctx.output.assignments`
   (neither primary nor secondary).
2. **Return-day is OT-only via Phase C.** A return-day driver, if assigned at
   all, is assigned only `jobType === "OT"`. Never TJW / WERN / NORMAL.
3. **Day legality (retained).** For each driver's trips that day: ≤
   `MAX_JOBS_PER_DAY`, no pairwise time overlap, a 2-trip day forms a legal
   `canChain` pair.
4. **Secondary rules (retained).** A `secondaryDriverId` is present only when
   the booking distance > `LONG_TRIP_KM`, and is never equal to the primary.
5. **Completeness (retained).** `assignments.length + overflows.length ===
   bookings.length`.

### 6.2 Cross-day, tracked across the run

6. **No assignment during an away span.** For every committed multi-day TJW,
   the locked driver(s) receive no assignment on any day strictly between the
   trip's start day and its return day.
7. **Freed on return (deterministic).** Once a driver's TJW `endAt` has passed,
   that driver no longer appears in any later day's `activeTjwCommitments` and
   is therefore eligible again. Assert the structural fact (not "gets assigned",
   which is demand-dependent and would flake): no driver is held away past their
   committed `endAt`.

### 6.3 Fairness — reported metric + soft assertion (resolved open decision)

Multi-day TJW means some drivers are legitimately away for days and will do
fewer trips, so the existing hard "spread ≤ 5%" assertion on raw trip counts is
no longer valid. Resolution:

- **Gross fairness is a reported metric, not a hard assertion** (raw min..max
  spread + Gini in the §7 report).
- **Soft assertion:** the spread of each driver's *availability-adjusted* trip
  rate — `trips / available-day-count`, where an available day is one the driver
  was neither away-on-TJW nor the duty driver — stays within a tolerance.
  Start the tolerance at 10%; during implementation, observe the seeded
  baseline and tighten to the smallest stable value (a concrete calibration
  step, not an open question). If even the availability-adjusted spread blows
  out, that is a finding to surface (possible solver bias), not a number to
  paper over.

## 7. Metrics (A) — what the script prints

```
Metrics {
  totalBookings, totalAssigned
  overflowByReason: { NO_PRIMARY_DRIVER, NO_SECONDARY_DRIVER, NEEDS_WERN_RECLAIM_DECISION }
  perDriverByType:  driver -> { TJW, OT, WERN, NORMAL }   (primary+secondary trips)
  earnings:         driver -> weighted earningsScore
  fairness:         per-type [min..max], overall Gini
  utilization:      busyDriverDays / idleDriverDays / awayDriverDays / totalDriverDays
  tjw:              multiDayTjwCount, avgAwaySpanDays
}
```

The script keeps its current human-readable table layout and adds the
utilization and TJW rows.

## 8. If the fuzz finds a real solver bug

The fuzz may surface a genuine `batch-solver.ts` defect (e.g. a secondary
driver not held across the full span, an off-by-one in `returnsBeforeCutoffToday`).
If so, follow systematic-debugging: reproduce with a **focused failing unit
test** first, apply the **minimal** correctness fix to `batch-solver.ts`, and
re-run. If the "bug" turns out to be a business-rule ambiguity (e.g. should a
returnee be eligible for NORMAL too?), **surface it for a decision** rather than
changing behaviour unilaterally. Any such fix stays minimal and within this
sub-project; broader assignment-logic changes belong to D.

## 9. Files changed

| File | Change |
|---|---|
| `lib/booking/simulation.ts` | **new** — pure shared core (`mulberry32`, `generateDay`, `simulate`, types, metrics) |
| `lib/booking/solver-invariants.test.ts` | rewrite to consume `simulate` with `onDay` invariants (§6.1) + cross-day + run-level assertions (§6.2, §6.3); add focused multi-day-TJW unit cases (away on day 2 of 3 → unassigned; freed on day 4) |
| `scripts/simulate-driver-distribution.ts` | rewrite to consume `simulate` and print the §7 metrics |
| `lib/booking/batch-solver.ts` | **only if** §8 applies — minimal correctness fix, test-first |

## 10. Testing & verification

- Property fuzz: `simulate({ days: 500, ... })` with `onDay` invariants, plus a
  handful of focused deterministic unit cases.
- Run booking tests with `--no-file-parallelism` (project rule):
  `npx vitest run --no-file-parallelism lib/booking/`.
- `npx tsc --noEmit` clean; `npm run lint` clean (the new file and rewrites must
  not reintroduce lint errors — CI does not yet gate lint, so this is on the
  author).
- Smoke-run the dev script: `npx tsx scripts/simulate-driver-distribution.ts`
  exits 0 and prints the new metrics.

## 11. Risks

- **Fairness assertion churn** — the availability-adjusted soft assertion must
  be calibrated to the seeded baseline (§6.3); too tight and it flakes, too
  loose and it is meaningless.
- **Generator realism** — synthetic load is not real demand; metrics are for
  relative comparison (before/after a change), not absolute capacity claims.
  The script output should say so.
- **Determinism** — all randomness via the seeded PRNG; no `Date.now()` /
  `Math.random()`; fixed base date. A given seed must reproduce exactly.

## 12. Out of scope / follow-ups

- **C — effort-weighted fairness:** replace coarse `JOB_WEIGHT` with
  duration/distance/฿ effort + window/decay. Separate spec.
- **D — overflow reduction:** attack `NO_PRIMARY` (packing, secondary
  selection, Phase-C reach), measured on this harness. Separate spec.
