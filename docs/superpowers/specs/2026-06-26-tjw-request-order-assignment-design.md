# Design — TJW assignment by request order (cross-day)

**Date:** 2026-06-26
**Branch:** `feat/new-algorithm` (off `main`; baseline = no no-wait work)
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** Changes **only** how TJW (multi-day out-of-province) trips pick their driver.
OT / WERN / NORMAL keep the existing algorithm. Touches the scheduling core — read
`docs/scheduling-algorithm.md` before implementing.

---

## 1. Goal

Today the daily batch solver (`solveDay`, `lib/booking/batch-solver.ts`) runs **per-day**.
Within a day it resolves categories in fixed priority (TJW → OT → WERN → NORMAL), FCFS by
`createdAt` *within* a category, and picks each TJW's driver by **rotation** (oldest
`Driver.lastTjwAt`) + earnings fairness.

The new variant assigns TJW in **global request order**: pending TJW requests are processed
**sorted by `createdAt` across all days** — the earliest request gets first pick of the driver
pool. The driver actually chosen is still the fairest eligible one (rotation + fairness),
so each assignment bumps that driver's rotation stamp and the next request falls to the
next-fairest. Example: a TJW requested 25 Jun (trip 10 Jul) is assigned before a TJW
requested 26 Jun (trip 2 Jul), even though the second trip is earlier — request date, not
trip date, sets the order.

**Only TJW changes.** OT, WERN, NORMAL are untouched.

### Decisions (from brainstorming)

- **Driver pick unchanged:** request order sets the *sequence*; `rankForRotation(lastTjwAt)`
  + earnings still pick *which* driver (so A→B falls out of the rotation bump).
- **Global, `createdAt`-ordered pass** (not incremental-at-approval): faithful to request
  date, deterministic, re-runnable, simulate-able — matches the existing pure-solver pattern.
- **TJW pass runs first; the per-day solver stops assigning TJW.**

---

## 2. Current state

- `solveDay` (pure) assigns a day's pending bookings; TJW is one of its categories.
- `rankForRotation` (`rotations.ts`) ranks eligible drivers oldest-stamp-first + earnings.
- Multi-day TJW already produces `TjwCommitment`s; `solveDay` loads `activeTjwCommitments`
  and locks those drivers away (`awayOnTjw`). The per-day solver already treats a
  TJW-committed driver as unavailable for that day.
- `batch-actions.ts` (`runBatchAction`) loads a day's pending APPROVED+unassigned bookings,
  calls `solveDay`, writes assignments, bumps rotation stamps.
- >400 km TJW requires a co-driver (`LONG_TRIP_KM`); the solver pairs one.

So the machinery for "TJW driver locked across a span" + "rotation/fairness pick" already
exists. The change is **the order TJW requests are processed** (global `createdAt`, not
per-day) and **moving TJW assignment out of `solveDay` into a dedicated pass**.

---

## 3. Core (pure) — `solveTjwByRequest` (`lib/booking/tjw-request-solver.ts`)

```ts
export interface TjwRequestInput {
  bookingId: string;
  createdAt: Date;          // the request date — the ordering key
  startAt: Date;
  endAt: Date;
  estimatedDistance: number | null;  // >LONG_TRIP_KM ⇒ needs a co-driver
}

export interface TjwSolveInput {
  requests: TjwRequestInput[];        // pending APPROVED + unassigned TJW, any day
  drivers: DriverRotationState[];     // reuse the existing rotation/fairness state
  driverCar: Map<string, string>;     // car=driver: only car-paired drivers dispatchable
  // Drivers already locked away by ASSIGNED/committed TJW (and duty per day) — fixed.
  existingCommitments: TjwCommitment[];
  dutyByDay: Map<number, string>;     // day-midnight ms → duty driverId (excluded that day)
}

export interface TjwAssignment {
  bookingId: string;
  primaryDriverId: string;
  secondaryDriverId: string | null;   // >400 km co-driver
}

export interface TjwSolveResult {
  assignments: TjwAssignment[];
  overflows: { bookingId: string; reason: "NO_PRIMARY_DRIVER" | "NO_SECONDARY_DRIVER" }[];
}

export function solveTjwByRequest(input: TjwSolveInput): TjwSolveResult;
```

**Algorithm:**
1. Sort `requests` by `createdAt` asc, tie-break `bookingId` asc (deterministic).
2. Seed each driver's committed spans from `existingCommitments` (fixed away-locks).
3. For each request in order:
   - **Eligible** = car-paired drivers who are **free across `[startAt, endAt]`** (no overlap
     with any already-assigned/committed span in this run) **and not the duty driver** on any
     day the TJW spans.
   - Pick the **fairest** eligible via `rankForRotation` on `lastTjwAt` (+ earnings tie-break) —
     the existing helper, unchanged.
   - If none → overflow `NO_PRIMARY_DRIVER`.
   - If `estimatedDistance > LONG_TRIP_KM`: pick a **second** eligible driver (fairest of the
     rest, also free across the span) as co-driver; none → overflow `NO_SECONDARY_DRIVER`.
   - Record the assignment; **provisionally bump** the chosen driver(s)' `lastTjwAt` (to this
     trip's `startAt`) + earnings, and add their committed span, so subsequent requests see
     the updated rotation + occupancy (this is what makes the 2nd request fall to the next
     driver).

Pure — no I/O. Mirrors `solveDay`'s provisional-stamping pattern.

---

## 4. Integration

- **New action** `assignTjwByRequestOrder` (`lib/booking/tjw-request-actions.ts`, admin-only):
  loads all **pending APPROVED + unassigned TJW** (across days) + the driver pool + rotation
  state + existing TJW commitments + per-day duty; runs `solveTjwByRequest`; writes each
  assignment (set `primaryDriverId` [+ `secondaryDriverId`], `status = ASSIGNED`,
  `decidedAt`) and bumps `lastTjwAt`/earnings — reusing the same write + stamp helpers as
  `runBatchAction`. Surfaces overflows for Khun Top. Re-runnable.
- **`solveDay` stops assigning TJW.** Two coordinated parts:
  - `runBatchAction`'s pending query **excludes `jobType = "TJW"`** (TJW is handled by the new
    pass), so the day batch only solves OT/WERN/NORMAL.
  - TJW drivers assigned by the pass flow into `solveDay` as `activeTjwCommitments` (already
    loaded), so the per-day solver still treats them as away — unchanged.
- Trigger: an admin button on the batch/schedule console ("Assign TJW (request order)"),
  run before the daily batch. (Chaining it automatically before `runBatchAction` is a
  follow-up option, not required for v1.)

---

## 5. Idempotency / re-run

The pass assigns **only currently-unassigned** pending TJW; **already-assigned TJW are fixed
commitments** (never moved). Re-running is safe + additive — it never reshuffles confirmed
trips. (A full global re-solve that could move confirmed TJWs is explicitly out of scope.)

---

## 6. Edge cases

- **No eligible driver** (all committed/away/duty across the span) → overflow
  `NO_PRIMARY_DRIVER`, surfaced like today's overflow list. No silent drop.
- **>400 km, no free co-driver** → overflow `NO_SECONDARY_DRIVER`.
- **Same driver, two non-overlapping TJWs:** allowed — a driver free on both 2 Jul and 10 Jul
  may take both; the rotation bump just makes the next-fairest more likely to win the 2nd.
- **Duty driver:** excluded from TJW on any day the trip spans (they're needed on campus).
- **`createdAt` ties:** broken by `bookingId` for determinism.
- **Cancellation/rollback:** reuse existing `rollbackRotationStampsForBooking` so a cancelled
  TJW frees its driver + rolls the stamp back (same as today).

---

## 7. Testing

- **Unit (pure)** `tjw-request-solver.test.ts`: request-order sequencing (later trip-date but
  earlier `createdAt` wins); rotation bump makes the 2nd request fall to the next driver
  (the A→B example); span-eligibility (overlapping TJW excluded; non-overlapping allowed);
  duty exclusion; >400 km co-driver assigned / overflow; `createdAt` tie-break.
- **Invariant:** no driver double-booked across overlapping TJW spans.
- **Regression:** OT/WERN/NORMAL solver tests + `solver-invariants` unchanged and green
  (TJW simply no longer enters `solveDay`).
- **Scenario:** a `simulate-cr07` variant (or new flag) that assigns TJW by request order,
  with rule-check counters 0.

---

## 8. Out of scope

- Changing OT / WERN / NORMAL selection.
- Full global re-solve that moves already-confirmed TJW.
- Auto-chaining the TJW pass into `runBatchAction` (kept a separate admin action for v1).
- Any schema/migration change (uses existing `createdAt`, `lastTjwAt`, commitments).

---

## 9. Affected files (anticipated)

- `lib/booking/tjw-request-solver.ts` (new, pure) + `tjw-request-solver.test.ts` (new).
- `lib/booking/tjw-request-actions.ts` (new): the admin action (load → solve → write/stamp).
- `lib/booking/batch-actions.ts`: exclude `jobType = "TJW"` from the daily pending query.
- `lib/booking/batch-solver.ts`: (likely no change — TJW just stops arriving; confirm the
  category loop handles an empty TJW set, which it already does).
- A console trigger (button) on the batch or schedule admin page + en/th label.
- `docs/scheduling-algorithm.md`: document the TJW-by-request-order pass + that `solveDay`
  no longer assigns TJW.
- Tests under `lib/` + a `scripts/simulate-cr07.ts` scenario.

## 10. Self-review notes

- Reuses every existing primitive (`rankForRotation`, `TjwCommitment`/away-lock, `LONG_TRIP_KM`
  co-driver, rotation-stamp helpers) — the only genuinely new logic is the **global
  `createdAt` ordering** + **moving TJW out of `solveDay`**.
- Reversible: `feat/new-algorithm` is off clean `main`; the pure pass can be A/B'd in the
  simulator against the old behaviour before trusting it. Backup at `backup/pre-new-algorithm`.
</content>
