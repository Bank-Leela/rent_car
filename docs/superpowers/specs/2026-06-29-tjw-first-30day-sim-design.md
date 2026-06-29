# Design — ตจว-first pipeline + 30-day **fuzz** simulation

**Date:** 2026-06-29 (amended same day: random generator + no-wait + invariant gate)
**Branch:** `feat/sim-30day` (off `main`)
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** A persisted, viewable **30-day** demo that runs the real scheduling pipeline
— **ตจว + multi-day first, then the per-day batch** — over a month of **randomly
generated** bookings, and **checks the scheduling invariants** on the result. It is a
**fuzz test**: random load may overflow (fine), but any rule violation is a surfaced
bug. Demo-only (`BatchDemo:`-tagged, clearable); the two production buttons are unchanged.

---

## 1. Why

`/admin/batch` has **"simulate day"**, but (a) it seeds a fixed, hand-picked set that
can't surface edge cases, (b) the daily batch now skips ตจว, so seeded ตจว never get
assigned, and (c) there's no month-horizon view. This feature seeds a **random** month,
runs the **ตจว-first pipeline**, and **asserts invariants** — so it actually validates
the algorithm under realistic/adversarial load instead of a rigged happy path.

## 2. Pipeline order

Planning runs in a fixed order; the sim orchestrates it:
1. **`assignTjwByRequestOrder`** — pending ตจว (multi-day/overnight), request-order, cross-day.
2. **`runBatchAction({ date })` per day** — OT/WERN/NORMAL; sees ตจว-committed drivers as away.

Order matters (ตจว reserves multi-day drivers before the per-day batch fills around them).

## 3. Random generator (replaces fixed `DEMO_SLOTS`)

`generateRandomDemoBookings(start: Date, days: number, seed: number): GeneratedBooking[]`
— a seeded RNG (reuse simulate-cr07's `rng(seed)`/`randInt` technique):

- **Per day:** a random count `0..N` where the ceiling occasionally **exceeds** the
  ~11/day capacity (so overflow happens — it must be observable, not engineered away).
- **Per booking, random within VALID bounds:**
  - **jobType** — weighted mix of `NORMAL` / `OT` / `WERN` / `ตจว(TJW)` (+ occasional
    `SMUS`). WERN ≈ the day's duty round.
  - **times** — random start within and around the 08/16 OT edges; random duration.
  - **distance** — random, including `> LONG_TRIP_KM` (→ co-driver path).
  - **passengers / male / female** — random small counts.
  - **province / outOfProvince** — random; **ตจว is always out-of-province + overnight**
    (multi-day, random 1–3 day span) — required for it to classify as ตจว.
  - **createdAt** — randomized request dates, spread *before* and **shuffled vs** trip
    date, so the ตจว request-order pass has a meaningful, non-trivial ordering.
- **Schema-valid by construction:** randomness stays inside valid bounds (ตจว overnight,
  no-wait same-day+ordered, sane times), so every insert succeeds. The fuzzing probes
  **capacity and edges**, never invalid input.
- All rows `BatchDemo:`-tagged; ensures an `OnCallShift` per day (duty rotates).

### 3b. No-wait case (NEW)

A random share (≈25%) of **same-day** `NORMAL`/`OT` trips get `waitAtDestination=false`
with a valid same-day split: `startAt < dropOffDone < pickupReturnTime < endAt` (times
random **within** that ordering). This exercises the **leg-aware `solveDay`** capacity
(the freed middle becoming bookable). ตจว/overnight trips are never no-wait (the split is
same-day only).

### 3c. Seed

The action generates a **random seed each run** (`Math.floor(Math.random()*1e9)`),
threads it through the RNG, and **returns it in the summary**, so a run that surfaces a
violation can be replayed exactly.

## 4. `runDemoSimulation` + `simulate30DaysAction`

`runDemoSimulation(start, days, seed): Promise<ThirtyDaySummary>`:
1. `generateRandomDemoBookings` → persist as `BatchDemo:` bookings (`status APPROVED`).
2. `assignTjwByRequestOrder()` once.
3. `runBatchAction({ date })` for each day → collect per-day stats.
4. **Invariant check** (§5) on the persisted assignments.
5. Aggregate `ThirtyDaySummary`.

`simulate30DaysAction(formData)` — admin-only wrapper: parse start `date`, pick a random
seed, `runDemoSimulation(date, 30, seed)`, revalidate, return the summary.

```ts
interface RuleViolation { type: "DOUBLE_BOOK" | "GAP_2H" | "NORMAL_CAP" | "AWAY_CONFLICT"; detail: string; }
interface ThirtyDaySummary {
  startDate: string; days: number; seed: number;
  seededCount: number; tjwAssigned: number; tjwOverflow: number; noWaitCount: number;
  perDay: { date: string; matched: number; pending: number; overflow: number }[];
  totals: { matched: number; pending: number; overflow: number };
  fairness: { min: number; max: number; spread: number; stddev: number };
  ruleViolations: RuleViolation[]; // empty = clean
}
```

## 5. Invariant check (the fuzz gate)

After the pipeline, load the persisted assignments for the range and verify **leg-aware**
(using `tripLegs` / `legsOverlap` from `lib/booking/trip-legs.ts`), per driver:
- **DOUBLE_BOOK** — no two assigned legs overlap for the same driver (primary or co-driver).
- **GAP_2H** — consecutive same-day trips honor the 2-hour gap (the `canChain` rule).
- **NORMAL_CAP** — ≤ 2 NORMAL trips/day per driver.
- **AWAY_CONFLICT** — a driver on a multi-day ตจว has no other assignment overlapping that span.

Each violation → a `RuleViolation` entry. **Overflows are NOT violations** (expected under
load). A non-empty `ruleViolations` is a **surfaced algorithm bug** — surfaced with the
seed to reproduce.

## 6. UI

- **"จำลอง 30 วัน / Simulate 30 days"** button on `batch-run-form.tsx`. On click →
  `simulate30DaysAction` → summary panel: totals, ตจว-assigned, no-wait count, fairness
  spread, **seed**, per-day matched/overflow, and a **prominent RULE VIOLATIONS block**
  (green "0 — clean" or red list with the seed). Toast on completion.
- i18n `simulate30*` + violation labels, en + th parity.

## 7. Clear-demo

`clearBatchDemoAction` already wipes ALL `BatchDemo:` rows across every date — reuse;
no change. Confirm it covers the random month.

## 8. Testing

- **Generator** (unit, seeded): produces schema-valid bookings; includes ตจว (overnight,
  out-of-province) and no-wait (same-day, ordered legs); same seed → same output.
- **Invariant checker** (unit): catches a **planted** double-book (and a planted cap
  breach), passes a clean arrangement.
- **Fuzz run** (integration, fixed seed, short e.g. 3-day range): full pipeline →
  `ruleViolations` is empty.
- Existing suite stays green (this only adds a generator + checker + orchestration; no
  scheduling-rule change).

## 9. Non-goals

- No change to production "Run batch" / "Assign ตจว" buttons, `solveDay`,
  `solveTjwByRequest`, scheduling rules, or schema.
- No new production "plan day" combo action.
- Not a load/perf test — 30 days × random load is fine for an admin-triggered demo
  (≈30 batch transactions; may take a few seconds).

## 10. Affected files (anticipated)

- `lib/booking/batch-demo-actions.ts` — `generateRandomDemoBookings`, no-wait mixing,
  `runDemoSimulation`, `simulate30DaysAction`, `ThirtyDaySummary`/`RuleViolation`.
- `lib/booking/sim-invariants.ts` (new, pure) — the leg-aware invariant checker + tests.
- `components/forms/batch-run-form.tsx` — button + summary/violations panel.
- `messages/{en,th}.json` — `simulate30*` + violation keys.
- Tests under `lib/booking/`.

## 11. Self-review notes

- The headline shift from the original spec: the seeder is now **random + fuzzing** (not
  curated), it includes **no-wait**, and the run **asserts invariants** — turning the demo
  into a real validator. Reuses `tripLegs`/`legsOverlap`, the RNG technique, the pipeline
  actions, and the `BatchDemo:` lifecycle.
- "As random as possible" is bounded by schema validity (invalid input would just fail the
  insert, testing nothing) — the randomness lives in distribution, volume, and edges.
</content>
