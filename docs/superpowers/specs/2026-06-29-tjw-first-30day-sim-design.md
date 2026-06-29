# Design — ตจว-first pipeline + 30-day simulation

**Date:** 2026-06-29
**Branch:** `feat/sim-30day` (off `main`)
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** A persisted, viewable **30-day** demo simulation that runs the new
scheduling pipeline in the correct order — **ตจว + multi-day first, then the
per-day batch** — so the algorithm can be validated over a month. Demo-only flow
(`BatchDemo:`-tagged, clearable); the two production buttons are **not** changed.

---

## 1. Why

`/admin/batch` already has **"simulate day"** (`simulateAndRunBatchAction`): seed one
day of `BatchDemo:` bookings, run the daily batch. But the daily batch now **skips
ตจว** (`jobType notIn [SMUS, TJW]`) — ตจว is assigned by the separate **"Assign ตจว"**
pass (`assignTjwByRequestOrder`). So a plain day-sim **never assigns the seeded
ตจว/overnight trips**. The fix is to run the **pipeline in order** and extend it to a
month so the request-order algorithm is visible at horizon.

## 2. Pipeline order (the "sort ตจว first" requirement)

Planning runs in a fixed order:

1. **`assignTjwByRequestOrder`** — all pending ตจว (multi-day/overnight), sorted by
   request date (`createdAt`), cross-day, fairest eligible driver each. Reserves
   multi-day drivers first.
2. **`runBatchAction({ date })` per day** — OT / WERN / NORMAL, which already treats
   the ตจว-committed drivers as away (`activeTjwCommitments`).

**Order matters:** the ตจว pass must run before the per-day batch, or the batch could
hand a multi-day driver a same-day OT that the ตจว trip then needs. The 30-day sim
orchestrates this order explicitly. (Production already achieves it **when the ตจว
button is run before the batch**; a one-click production "plan day (ตจว-first)" is a
possible follow-up — **out of scope** here.)

## 3. 30-day seed generator

Extend the demo seeder (`lib/booking/batch-demo-actions.ts`) with a range seeder:

- `seedBatchDemoRange(startDate, days = 30): Promise<number>` — for each of `days`
  consecutive days from `startDate`:
  - seed the existing per-day OT / WERN / NORMAL mix (reuse the current `DEMO_SLOTS`
    logic for that day);
  - sprinkle a few **ตจว / multi-day overnight** trips (spanning 1–3 days) with
    **varied `createdAt`** (request dates spread *earlier* than their trip dates, and
    deliberately out of trip-date order) so the request-order pass has meaningful
    ordering to demonstrate;
  - ensure an `OnCallShift` exists for the day (WERN duty rotates daily — reuse the
    current logic).
- All rows keep the `BatchDemo:` tag. Returns total seeded count.

`seedBatchDemoForDate` is kept (the 1-day sim still uses it) — the range seeder may
call it per day plus add the cross-day ตจว.

## 4. `simulate30DaysAction`

New action in `batch-demo-actions.ts`:

```ts
export async function simulate30DaysAction(
  formData: FormData,             // { date } = start day
): Promise<ActionResult & { summary?: ThirtyDaySummary }>;
```

Flow (admin-only):
1. `seedBatchDemoRange(startDate, 30)`.
2. `assignTjwByRequestOrder()` once — assigns all seeded ตจว in request order.
3. For each of the 30 days: `runBatchAction({ date })` (collect each day's stats).
4. Aggregate `ThirtyDaySummary`:
   - `seededCount`, `tjwAssigned` (count + the request-order sequence),
   - per-day `{ date, matched, pending, overflowByReason }`,
   - month totals + **fairness spread** (per-driver assignment count: min/max/stddev).
5. `revalidatePath("/admin/batch")` + `/admin/schedule`.

Persisted → every seeded+assigned trip is browsable on the board/calendar for its day.

## 5. UI

- **"จำลอง 30 วัน / Simulate 30 days"** button on `components/forms/batch-run-form.tsx`,
  next to "simulate day". On click → `simulate30DaysAction({ date })` → render a
  **30-day summary** panel (totals, ตจว-assigned count, fairness spread, and a compact
  per-day matched/overflow list). Fire a toast on completion (reuse `useActionToast`).
- i18n: `adminBatch.simulate30`, `simulate30Helper`, summary labels — en + th parity.

## 6. Clear-demo extended

`clearBatchDemoAction` currently clears one day. Extend it to wipe **all `BatchDemo:`-
tagged bookings** (whole range), so a 30-day run is fully reversible in one click.
(Delete the bookings + their dependent rows — audit logs, drafts, trips — same as the
existing clear, just unscoped from a single date.)

## 7. Testing

- **Unit/integration** (`batch-demo-actions.test.ts` or a focused new test, seeded dev DB):
  seed a **short** range (e.g. 3 days) → run the pipeline → assert
  (a) ตจว were assigned **before**/independently of the per-day batch and in
  `createdAt` order, (b) each day's non-ตจว bookings were processed, (c) no driver
  double-booked across overlapping ตจว spans. Clean up by `BatchDemo:` tag in `afterAll`.
- The existing **336-test suite stays green** (no scheduling-logic change — this only
  orchestrates existing actions + adds a seeder).
- Optional: `simulate-cr07` unaffected (separate CLI).

## 8. Non-goals

- No change to the production "Run batch" / "Assign ตจว" buttons or their actions.
- No new production "plan day" combo action (possible follow-up).
- No change to `solveDay` / `solveTjwByRequest` / scheduling rules.
- No schema change.
- Not a load test — 30 days × ~11/day is fine for a demo; it's admin-triggered and
  may take a few seconds (≈30 batch transactions).

## 9. Affected files (anticipated)

- `lib/booking/batch-demo-actions.ts` — `seedBatchDemoRange`, `simulate30DaysAction`,
  extend `clearBatchDemoAction`; `ThirtyDaySummary` type.
- `components/forms/batch-run-form.tsx` — the button + summary panel.
- `messages/{en,th}.json` — `simulate30*` + summary keys (en+th parity).
- Test under `lib/booking/`.

## 10. Self-review notes

- Reuses existing primitives end-to-end (`assignTjwByRequestOrder`, `runBatchAction`,
  the demo seeder, `useActionToast`, `BatchDemo:` tag). The only new logic is the range
  seeder + the orchestration/aggregation — no scheduling rule is touched.
- The headline value: it makes the **ตจว-first order explicit and observable** over a
  month, which the 1-day sim could not (it silently dropped ตจว).
</content>
