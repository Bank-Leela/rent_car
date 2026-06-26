# No-wait Trip Split (Two Legs, Capacity-Affecting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `Booking.waitAtDestination = false`, a trip becomes two intervals (drop-off leg + return-pickup leg); the freed middle is real bookable capacity across scheduling logic and renders as two blocks on every day-view.

**Architecture:** One pure helper `lib/booking/trip-legs.ts` (`tripLegs`/`legsOverlap`/`minLegGapMinutes`) is the single source of truth. `canChain` (the eligibility chokepoint the matcher + solver both call), `conflict-resolve`, and the two `schedule-actions` no-overlap sites switch to leg comparisons; `daySpan` callers render one block per leg. A new `Booking.dropOffDone DateTime?` bounds leg 1.

**Tech Stack:** Next.js (app router), Prisma + Postgres, zod, next-intl, vitest, date-fns.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-26-no-wait-trip-split-legs-design.md`.
- Read `docs/scheduling-algorithm.md` before editing any `lib/booking/*` rule file. This touches the no-overlap / `canChain` invariant — the most-churned rule.
- **Single source of truth:** all overlap/gap/leg math goes through `lib/booking/trip-legs.ts`. No inline leg logic anywhere else.
- **Back-compat:** `dropOffDone = null` ⇒ one interval ⇒ behavior identical to today. Verify this holds at every step.
- **No-wait split is same-day only**, ordering `startAt < dropOffDone < pickupReturnTime < endAt`, all four on the same calendar day. Multi-day/TJW = always wait.
- A split trip is **one** job for the NORMAL one-morning+one-afternoon cap; a trip placed in the gap is a separate job.
- Verify after `.ts`/`.tsx`: `npm run typecheck`. Tests serial: `npx vitest run --no-file-parallelism`. Scheduling gate: `npx tsx scripts/simulate-cr07.ts --scenario=<mixed|normal|ot|tjw|tight|chain|reclaim>` (rule-check counters must stay 0). DB tests need a seeded dev DB.

---

### Task 1: Schema — `Booking.dropOffDone` + `TripTemplate.dropOffDone`

**Files:**
- Modify: `prisma/schema.prisma` (Booking model near `pickupReturnTime`; TripTemplate model near its `pickupReturnTime`)
- Migration: `prisma/migrations/<ts>_add_drop_off_done/migration.sql`

**Interfaces:**
- Produces: `Booking.dropOffDone: DateTime?`, `TripTemplate.dropOffDone: DateTime?`.

- [ ] **Step 1: Add the column to both models.** In `prisma/schema.prisma`, after `Booking.pickupReturnTime String?`:
```prisma
  pickupReturnTime  String?
  // No-wait split: end of leg 1 (driver free after the drop-off run). Null ⇒
  // single-interval trip. Only meaningful when waitAtDestination = false.
  dropOffDone       DateTime?
```
and after `TripTemplate.pickupReturnTime String?`:
```prisma
  pickupReturnTime   String?
  dropOffDone        DateTime?
```

- [ ] **Step 2: Hand-write the migration** (repo uses hand-written migrations; `migrate dev` is interactive-blocked here). Create `prisma/migrations/<ts>_add_drop_off_done/migration.sql` (use a timestamp after the latest existing one, e.g. `20260626130000`):
```sql
-- No-wait split: end of leg 1 (driver free after drop-off). Null ⇒ single interval.
ALTER TABLE "Booking" ADD COLUMN "dropOffDone" TIMESTAMP(3);
ALTER TABLE "TripTemplate" ADD COLUMN "dropOffDone" TIMESTAMP(3);
```

- [ ] **Step 3: Apply + regenerate** (DB up):
```bash
npx prisma migrate deploy && npx prisma generate
```
Expected: migration applied; `migrate status` → up to date.

- [ ] **Step 4: Typecheck** — `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(booking): add dropOffDone column for no-wait split`

---

### Task 2: Pure helper `lib/booking/trip-legs.ts` (single source of truth)

**Files:**
- Create: `lib/booking/trip-legs.ts`
- Test: `lib/booking/trip-legs.test.ts`

**Interfaces:**
- Produces:
  - `type Interval = { startAt: Date; endAt: Date }`
  - `type LegSource = { startAt: Date; endAt: Date; waitAtDestination: boolean; dropOffDone: Date | null; pickupReturnTime: string | null }`
  - `tripLegs(b: LegSource): Interval[]`
  - `legsOverlap(a: LegSource, b: LegSource): boolean`
  - `minLegGapMinutes(a: LegSource, b: LegSource): number`

- [ ] **Step 1: Write the failing tests** — `lib/booking/trip-legs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { tripLegs, legsOverlap, minLegGapMinutes } from "./trip-legs";

const at = (h: number, m = 0) => { const d = new Date(2026, 5, 26); d.setHours(h, m, 0, 0); return d; };
const wait = (s: Date, e: Date) => ({ startAt: s, endAt: e, waitAtDestination: true, dropOffDone: null, pickupReturnTime: null });
const split = (s: Date, drop: Date, ret: string, e: Date) => ({ startAt: s, endAt: e, waitAtDestination: false, dropOffDone: drop, pickupReturnTime: ret });

describe("tripLegs", () => {
  it("returns one interval when waiting", () => {
    expect(tripLegs(wait(at(8), at(12)))).toHaveLength(1);
  });
  it("returns one interval when no-wait but data missing (back-compat)", () => {
    expect(tripLegs({ ...wait(at(8), at(12)), waitAtDestination: false })).toHaveLength(1);
  });
  it("returns two intervals for a no-wait split", () => {
    const legs = tripLegs(split(at(8), at(10), "15:30", at(18)));
    expect(legs).toHaveLength(2);
    expect(legs[0]).toEqual({ startAt: at(8), endAt: at(10) });
    expect(legs[1]).toEqual({ startAt: at(15, 30), endAt: at(18) });
  });
});

describe("legsOverlap", () => {
  it("false when the other trip sits entirely in the free gap", () => {
    expect(legsOverlap(split(at(8), at(10), "15:30", at(18)), wait(at(11), at(13)))).toBe(false);
  });
  it("true when the other trip hits leg 1", () => {
    expect(legsOverlap(split(at(8), at(10), "15:30", at(18)), wait(at(9), at(9, 30)))).toBe(true);
  });
  it("true when the other trip hits leg 2", () => {
    expect(legsOverlap(split(at(8), at(10), "15:30", at(18)), wait(at(16), at(17)))).toBe(true);
  });
  it("touching edges do not overlap", () => {
    expect(legsOverlap(wait(at(8), at(10)), wait(at(10), at(12)))).toBe(false);
  });
});

describe("minLegGapMinutes", () => {
  it("measures the smallest gap to any leg", () => {
    // other ends 09:00; leg1 starts 10:00 → 60 min
    expect(minLegGapMinutes(split(at(10), at(12), "15:30", at(18)), wait(at(7), at(9)))).toBe(60);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found):
`npx vitest run lib/booking/trip-legs.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement `lib/booking/trip-legs.ts`:**
```ts
export type Interval = { startAt: Date; endAt: Date };

export type LegSource = {
  startAt: Date;
  endAt: Date;
  waitAtDestination: boolean;
  dropOffDone: Date | null;
  pickupReturnTime: string | null; // "HH:mm", leg-2 start on the booking's day
};

// Resolve an HH:mm onto the calendar day of `ref`.
function onDay(ref: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(ref);
  d.setHours(h, m, 0, 0);
  return d;
}

// One interval when waiting or when split data is incomplete (back-compat);
// two intervals for a no-wait trip with both a drop-off-done time and a return time.
export function tripLegs(b: LegSource): Interval[] {
  if (b.waitAtDestination || !b.dropOffDone || !b.pickupReturnTime) {
    return [{ startAt: b.startAt, endAt: b.endAt }];
  }
  return [
    { startAt: b.startAt, endAt: b.dropOffDone },
    { startAt: onDay(b.startAt, b.pickupReturnTime), endAt: b.endAt },
  ];
}

// Half-open overlap: touching edges (a.end === b.start) do NOT overlap.
function intervalsOverlap(a: Interval, c: Interval): boolean {
  return a.startAt < c.endAt && c.startAt < a.endAt;
}

export function legsOverlap(a: LegSource, b: LegSource): boolean {
  const la = tripLegs(a), lb = tripLegs(b);
  return la.some((x) => lb.some((y) => intervalsOverlap(x, y)));
}

// Smallest gap in minutes between any non-overlapping pair of legs. 0 if they overlap.
export function minLegGapMinutes(a: LegSource, b: LegSource): number {
  const la = tripLegs(a), lb = tripLegs(b);
  let min = Infinity;
  for (const x of la) for (const y of lb) {
    if (intervalsOverlap(x, y)) return 0;
    const gap = x.endAt <= y.startAt
      ? y.startAt.getTime() - x.endAt.getTime()
      : x.startAt.getTime() - y.endAt.getTime();
    min = Math.min(min, gap);
  }
  return Math.round(min / 60000);
}
```

- [ ] **Step 4: Run — expect PASS.** `npx vitest run lib/booking/trip-legs.test.ts --no-file-parallelism`
- [ ] **Step 5: Typecheck** — `npm run typecheck`.
- [ ] **Step 6: Commit** — `feat(booking): trip-legs helper — single source of truth for no-wait legs`

---

### Task 3: zod — `dropOffDone` + no-wait ordering/same-day refine

**Files:**
- Modify: `lib/booking/schema.ts` (`newBookingSchema`, `tripTemplateSchema`)
- Test: `lib/booking/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `newBookingSchema` accepts `dropOffDone` (datetime-local string → Date) and, when `waitAtDestination=false`, requires `dropOffDone` + `pickupReturnTime` with `startAt < dropOffDone < pickupReturnTime < endAt`, all same calendar day.

- [ ] **Step 1: Failing tests** — add to `lib/booking/schema.test.ts` (uses the existing `baseInput`):
```ts
describe("newBookingSchema no-wait split", () => {
  const noWait = {
    ...baseInput,
    waitAtDestination: "false",
    dropOffDone: "2026-06-10T10:00",
    pickupReturnTime: "15:30",
    startAt: "2026-06-10T08:00",
    endAt: "2026-06-10T18:00",
  };
  it("accepts a well-ordered same-day split", () => {
    expect(newBookingSchema.safeParse(noWait).success).toBe(true);
  });
  it("rejects missing dropOffDone when not waiting", () => {
    const { dropOffDone, ...rest } = noWait;
    expect(newBookingSchema.safeParse(rest).success).toBe(false);
  });
  it("rejects dropOffDone after pickupReturnTime", () => {
    expect(newBookingSchema.safeParse({ ...noWait, dropOffDone: "2026-06-10T16:00" }).success).toBe(false);
  });
  it("rejects a cross-day split", () => {
    expect(newBookingSchema.safeParse({ ...noWait, endAt: "2026-06-11T09:00" }).success).toBe(false);
  });
  it("ignores dropOffDone when waiting (single interval)", () => {
    expect(newBookingSchema.safeParse({ ...baseInput, waitAtDestination: "true" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run lib/booking/schema.test.ts --no-file-parallelism`

- [ ] **Step 3: Add the field + refine.** In `lib/booking/schema.ts` add to the `newBookingSchema` object (near `pickupReturnTime`):
```ts
    dropOffDone: z
      .string()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v ? new Date(v) : undefined))
      .refine((d) => d === undefined || !Number.isNaN(d.getTime()), "Invalid drop-off time"),
```
Then extend the schema's `.refine(...)` chain (after the existing end-after-start refine) with a no-wait block:
```ts
  .refine(
    (d) => {
      if (d.waitAtDestination) return true;
      if (!d.dropOffDone || !d.pickupReturnTime) return false;
      const [h, m] = d.pickupReturnTime.split(":").map(Number);
      const ret = new Date(d.startAt); ret.setHours(h, m, 0, 0);
      const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
      return (
        d.startAt < d.dropOffDone && d.dropOffDone < ret && ret < d.endAt &&
        sameDay(d.startAt, d.dropOffDone) && sameDay(d.startAt, d.endAt)
      );
    },
    { path: ["dropOffDone"], message: "No-wait trips need startAt < drop-off < return < end, same day" },
  );
```
Add `dropOffDone` to `tripTemplateSchema` as `dropOffDone: optStr-style date` — accept an optional datetime-local string transformed to `Date | null` (mirror the booking field but nullable, no cross-field refine since templates are partial).

- [ ] **Step 4: Run — expect PASS.** `npx vitest run lib/booking/schema.test.ts --no-file-parallelism`
- [ ] **Step 5: Commit** — `feat(booking): zod dropOffDone + no-wait ordering/same-day refine`

---

### Task 4: Persist `dropOffDone` (create + recurrence + template)

**Files:**
- Modify: `lib/booking/actions.ts` (`sharedData` in `createBookingAction`; template apply/save in `lib/booking/template-actions.ts`)
- Test: `lib/booking/actions.test.ts`

**Interfaces:**
- Consumes: `newBookingSchema.dropOffDone`.
- Produces: created/child bookings + templates carry `dropOffDone`.

- [ ] **Step 1: Update an existing actions test** — in the first `createBookingAction` test payload add `waitAtDestination: "false"`, `dropOffDone: isoLocal(<+2h>)`, `pickupReturnTime: "15:30"`, and adjust that trip's `endAt` to same-day evening; assert `booking.dropOffDone` is set + `booking.waitAtDestination === false`.

- [ ] **Step 2: Run — expect FAIL** (not persisted). `npx vitest run lib/booking/actions.test.ts --no-file-parallelism` (seeded DB).

- [ ] **Step 3: Persist.** In `lib/booking/actions.ts`, add to the `sharedData` object (near `pickupReturnTime`):
```ts
      pickupReturnTime: data.pickupReturnTime,
      dropOffDone: data.dropOffDone ?? null,
```
(`sharedData` is spread into both the parent and recurrence-child `create`, so children inherit it.) In `lib/booking/template-actions.ts`, persist `dropOffDone` on save and copy it on apply, mirroring `pickupReturnTime`.

- [ ] **Step 4: Run — expect PASS.** `npx vitest run lib/booking/actions.test.ts --no-file-parallelism`
- [ ] **Step 5: Commit** — `feat(booking): persist dropOffDone on create/recurrence/template`

---

### Task 5: `canChain` leg-aware (the eligibility chokepoint)

**Files:**
- Modify: `lib/booking/rotations.ts` (`TimedJob` type + `canChain`)
- Test: `lib/booking/rotations.test.ts`

**Interfaces:**
- Consumes: `legsOverlap`, `minLegGapMinutes`, `TWO_HOUR_BUFFER_MS`.
- Produces: `TimedJob` gains optional `waitAtDestination?`, `dropOffDone?`, `pickupReturnTime?` (defaulting to a single interval when absent). `canChain` overlap + 2h-gap are per-leg.

- [ ] **Step 1: Failing tests** — add to `lib/booking/rotations.test.ts`:
```ts
import { tripLegs } from "./trip-legs"; // (ensure helper import if needed)
// helper to build a TimedJob; fill new fields as undefined for waiting trips
it("canChain: a trip fits in a no-wait gap", () => {
  const split = { startAt: at(8), endAt: at(18), jobType: "NORMAL", waitAtDestination: false, dropOffDone: at(10), pickupReturnTime: "15:30" };
  const filler = { startAt: at(11), endAt: at(13), jobType: "OT", waitAtDestination: true, dropOffDone: null, pickupReturnTime: null };
  expect(canChain(filler, [split])).toBe(true);
});
it("canChain: overlapping a leg is rejected", () => {
  const split = { startAt: at(8), endAt: at(18), jobType: "NORMAL", waitAtDestination: false, dropOffDone: at(10), pickupReturnTime: "15:30" };
  const hitsLeg2 = { startAt: at(16), endAt: at(17), jobType: "OT", waitAtDestination: true, dropOffDone: null, pickupReturnTime: null };
  expect(canChain(hitsLeg2, [split])).toBe(false);
});
```
(Define `at()` as in trip-legs.test, and extend the existing `TimedJob` test fixtures with the three new fields = undefined/null so they keep their current single-interval behavior.)

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run lib/booking/rotations.test.ts --no-file-parallelism`

- [ ] **Step 3: Make `canChain` leg-aware.** In `lib/booking/rotations.ts`:
  - Extend `TimedJob` with `waitAtDestination?: boolean; dropOffDone?: Date | null; pickupReturnTime?: string | null`.
  - Add a local adapter `const legSrc = (j: TimedJob) => ({ startAt: j.startAt, endAt: j.endAt, waitAtDestination: j.waitAtDestination ?? true, dropOffDone: j.dropOffDone ?? null, pickupReturnTime: j.pickupReturnTime ?? null });`
  - Replace the overlap + gap loop body:
```ts
  for (const e of existing) {
    if (legsOverlap(legSrc(next), legSrc(e))) return false; // overlap on any leg
    if (minLegGapMinutes(legSrc(next), legSrc(e)) < 120) return false; // <2h to any leg
  }
```
  (`waitAtDestination ?? true` keeps every existing caller single-interval until they pass the new fields — back-compat.)

- [ ] **Step 4: Run — expect PASS** (new + all existing canChain tests). `npx vitest run lib/booking/rotations.test.ts --no-file-parallelism`
- [ ] **Step 5: Commit** — `feat(scheduler): canChain overlap + 2h gap are per-leg`

---

### Task 6: Feed leg data through the matcher + solver

**Files:**
- Modify: `lib/booking/matching.ts`, `lib/booking/batch-solver.ts` (and their `select`/mapping in `matching-actions.ts` / `batch-actions.ts` if they build `TimedJob`s)
- Test: `lib/booking/solver-invariants.test.ts`

**Interfaces:**
- Consumes: leg-aware `canChain`.
- Produces: every `TimedJob`/occupancy record the matcher + solver build includes `waitAtDestination`, `dropOffDone`, `pickupReturnTime`.

- [ ] **Step 1: Failing test** — add to `solver-invariants.test.ts`: a generated day with one no-wait split trip; assert (a) no leg is double-booked, and (b) a trip whose window fits the gap is placed rather than overflowed.

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run lib/booking/solver-invariants.test.ts --no-file-parallelism`

- [ ] **Step 3: Thread the fields.** Wherever `matching.ts` / `batch-solver.ts` construct the `TimedJob[]` of existing commitments (and where `matching-actions.ts` / `batch-actions.ts` `select` booking rows), include `waitAtDestination`, `dropOffDone`, `pickupReturnTime` and pass them into the `TimedJob`. No occupancy logic changes beyond delegating to the now leg-aware `canChain`. Add `dropOffDone`/`waitAtDestination`/`pickupReturnTime` to the simulation generator (`lib/booking/simulation.ts`) so the fuzz can produce split trips.

- [ ] **Step 4: Run — expect PASS.** `npx vitest run lib/booking/solver-invariants.test.ts --no-file-parallelism`
- [ ] **Step 5: Scenario gate** — `npx tsx scripts/simulate-cr07.ts --scenario=mixed` → rule-check counters 0.
- [ ] **Step 6: Commit** — `feat(scheduler): matcher + solver pass leg data to canChain`

---

### Task 7: Manual no-overlap leg-aware (conflict-resolve + reassign)

**Files:**
- Modify: `lib/booking/conflict-resolve.ts`, `lib/booking/schedule-actions.ts` (`reassignVehicleAction`, the secondary-reassign overlap, and the `findConflictLosers` query)
- Test: `lib/booking/conflict-resolve.test.ts`, `lib/booking/schedule-actions.test.ts`

**Interfaces:**
- Consumes: `legsOverlap`, `tripLegs`.
- Produces: `ConflictTrip` carries `waitAtDestination`/`dropOffDone`/`pickupReturnTime`; `overlaps()` uses `legsOverlap`. `reassignVehicleAction` blocks a drop only when a leg overlaps; permits a drop into a gap.

- [ ] **Step 1: Failing tests** — `conflict-resolve.test.ts`: two trips on one car where one is a no-wait split and the other fits the gap → `findConflictLosers` returns empty; one that hits a leg → returns the loser. Extend `schedule-actions.test.ts` (DB): reassign a trip onto a car whose existing trip is a no-wait split, dropping into the gap → `{ ok: true }`; dropping onto a leg → blocked with the conflict.

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run lib/booking/conflict-resolve.test.ts --no-file-parallelism`

- [ ] **Step 3: Make `conflict-resolve.ts` leg-aware.** Add `waitAtDestination: boolean; dropOffDone: Date | null; pickupReturnTime: string | null` to `ConflictTrip`; replace the local `overlaps(a, b)` body with `return legsOverlap(a, b);` (import from `./trip-legs`). In `schedule-actions.ts`, the no-overlap query/check in `reassignVehicleAction` + secondary-reassign + the `findConflictLosers` row `select` must include the three fields and compare via `legsOverlap` (the manual 2h-gap override stays as-is — override relaxes the gap, never the overlap).

- [ ] **Step 4: Run — expect PASS.** `npx vitest run lib/booking/conflict-resolve.test.ts lib/booking/schedule-actions.test.ts --no-file-parallelism`
- [ ] **Step 5: Commit** — `feat(scheduler): manual no-overlap (reassign + conflict-resolve) per-leg`

---

### Task 8: Render two blocks across the 6 day-views

**Files:**
- Modify: `app/(admin)/admin/schedule/page.tsx` + `components/admin/scheduler-board-{blocks,shared}.tsx` (board); `app/(admin)/admin/calendar/page.tsx`; admin month grid; `app/(driver)/driver/calendar/page.tsx`; driver dashboard; batch ASSIGNED roster
- Modify: `messages/{en,th}.json` (leg labels)

**Interfaces:**
- Consumes: `tripLegs`. Each view maps a booking → `tripLegs(b)` and calls the existing `daySpan(leg.startAt, leg.endAt, dayStart, dayEnd)` once per leg, rendering one block per leg.

- [ ] **Step 1: i18n.** Add to `bookingForm` (or a `scheduler` namespace) in both `messages/en.json` + `messages/th.json`: `legDropOff` = "รับ" / "Drop-off", `legReturn` = "กลับมารับ" / "Return pickup". (Board is Thai-centric; keep both keys.)

- [ ] **Step 2: Board (worked example).** In the schedule page's `SchedulerBooking` build (`app/(admin)/admin/schedule/page.tsx`), where each booking currently becomes one block via `daySpan(b.startAt, b.endAt, …)`, branch on `tripLegs(b)`: for a 2-leg trip emit two `SchedulerBooking` block entries that share `id` but differ by a `legIndex: 0|1` + `legLabel` field (add to `SchedulerBooking` in `scheduler-board-shared.ts`). `TimelineBlock` (`scheduler-board-blocks.tsx`) renders `legLabel` (รับ / กลับมารับ) when present. DnD/tap key off `id` (unchanged) so dragging either leg moves the whole booking.

- [ ] **Step 3: Apply the same `tripLegs`→per-leg-`daySpan` pattern to the other 5 views** — admin day-calendar, admin month grid (`daysSpanned` per leg), driver month grid, driver dashboard, batch ASSIGNED roster. Each: read the file, replace the single `daySpan`/`daysSpanned` call with one call per `tripLegs(b)` interval. A 1-leg trip is unchanged.

- [ ] **Step 4: Typecheck + dev smoke.** `npm run typecheck`; `npm run dev`, open `/admin/schedule` with a seeded no-wait booking → two blocks with รับ/กลับมารับ and a free gap.

- [ ] **Step 5: Commit** — `feat(board): render no-wait trips as two legs across day-views`

---

### Task 9: Booking-form `dropOffDone` input

**Files:**
- Modify: `components/forms/booking-form.tsx`; `messages/{en,th}.json`

**Interfaces:**
- Consumes: the form already has the `waitAtDestination` toggle + `pickupReturnTime`. Add a `dropOffDone` DateTimePicker shown only when `waitAtDestination=false`.

- [ ] **Step 1: Add the input.** In the wait/pickup block of `booking-form.tsx`, when "no wait" is selected, render a `DateTimePicker id="dropOffDone" name="dropOffDone"` (label `t("dropOffDoneLabel")`) alongside `pickupReturnTime`. Add `dropOffDone` to the no-wait branch of the form's pre-submit validation so an empty value is caught in-form. Add `bookingForm.dropOffDoneLabel` + helper to en/th.

- [ ] **Step 2: Typecheck.** `npm run typecheck`.
- [ ] **Step 3: Commit** — `feat(booking-form): drop-off-done time input for no-wait trips`

---

### Task 10: Placement simulator — no-wait support (`/admin/simulate`)

**Files:**
- Modify: `components/admin/simulate-form.tsx`, `lib/booking/simulate-actions.ts`
- Modify: `messages/{en,th}.json` (toggle + field labels)

**Interfaces:**
- Consumes: leg-aware `solveDay`/`canChain` (T5–T6); `SolverBookingInput` + `ScheduledTrip` now carry `waitAtDestination`/`dropOffDone`/`pickupReturnTime` (added in T6).
- Produces: the simulator can place a no-wait split trip and honors existing no-wait gaps.

- [ ] **Step 1: Form inputs.** In `simulate-form.tsx` add a "driver waits" toggle (default on) and, when off, two `type="time"` inputs `name="dropOffDone"` + `name="pickupReturnTime"` (the form already uses plain `type="time"`/`type="date"` inputs). Add `simulate.waitLabel` / `simulate.dropOffLabel` / `simulate.returnLabel` to en/th.

- [ ] **Step 2: Read + validate in the action.** In `simulatePlacementAction` read `waitAtDestination` (`String(formData.get("wait")) !== "false"`), `dropOffDone` (HH:mm), `pickupReturnTime` (HH:mm). When not waiting: require both, build `dropOffDone = new Date(\`${dateStr}T${dropStr}:00\`)`, resolve return onto the day, and enforce `startAt < dropOffDone < return < endAt` (else `return { ok:false, error:"invalidSplit" }`). Add `i18n` for the error in the form's error map.

- [ ] **Step 3: Put leg fields on the synthetic booking + existing trips.** Add to the `synthetic: SolverBookingInput`:
```ts
    waitAtDestination,
    dropOffDone: waitAtDestination ? null : dropOffDone,
    pickupReturnTime: waitAtDestination ? null : pickupReturnStr,
```
and add `waitAtDestination: true, dropOffDone: true, pickupReturnTime: true` to the `assignedToday` `select`, and pass them through `addTrip` into each `ScheduledTrip` so an **existing** no-wait trip's gap is respected in the sim. (Both types gained these fields in T6.)

- [ ] **Step 4: Typecheck + dev smoke.** `npm run typecheck`; `npm run dev`, open `/admin/simulate`, choose a day with a busy car, enter a no-wait trip whose legs straddle that car's existing trip → simulator places it (or shows the overflow reason), proving leg-aware placement end-to-end.

- [ ] **Step 5: Commit** — `feat(simulate): no-wait split support in the placement simulator`

---

### Task 11: Rule doc + full verification

**Files:**
- Modify: `docs/scheduling-algorithm.md` (§4 `canChain`, §5 no-overlap)

- [ ] **Step 1: Doc.** In §4/§5 define "leg": a no-wait trip occupies two intervals (`[startAt,dropOffDone]`, `[pickupReturnTime,endAt]`); overlap + 2h gap are evaluated per-leg; the freed middle is bookable; a split trip is one job for the NORMAL cap. Note all leg math lives in `lib/booking/trip-legs.ts`.
- [ ] **Step 2: Typecheck** — `npm run typecheck` → clean.
- [ ] **Step 3: Full suite** — `npx vitest run --no-file-parallelism` → all green.
- [ ] **Step 4: Scenario gate** — run `simulate-cr07` for `mixed normal ot tjw tight chain reclaim` → every rule-check counter 0.
- [ ] **Step 5: Commit** — `docs(scheduling): leg-aware no-overlap + canChain for no-wait trips`

---

## Self-Review

**Spec coverage:** §3 data model (T1) ✓; §4 validation/same-day (T3) ✓; §5 trip-legs helper (T2) ✓; §6 rules leg-aware — canChain (T5), matcher/solver (T6), reassign/conflict-resolve (T7), rule doc (T11) ✓; §7 rendering all 6 views (T8) ✓; §7.1 placement simulator (T10) ✓; §8 testing (every task TDD + T11 gates) ✓; persist + form (T4, T9) ✓; §9 out-of-scope respected (no gap-hunting heuristic; no multi-day no-wait — enforced by T3 same-day refine) ✓.

**Placeholder scan:** code given for the new/tricky surfaces (helper, zod, canChain, conflict-resolve, migration); the 5 secondary renderers (T8 Step 3) and the matcher/solver field-threading (T6) reference exact files + the one pattern to apply, since their current code must be read per-file at implementation — not placeholders, but read-then-apply steps. Flagged so the implementer reads each file.

**Type consistency:** `LegSource`/`Interval` and `tripLegs`/`legsOverlap`/`minLegGapMinutes` are used identically in T5/T7; `TimedJob` and `ConflictTrip` both gain the same three optional fields (`waitAtDestination`/`dropOffDone`/`pickupReturnTime`); `dropOffDone` is `DateTime?`/`Date | null` everywhere; `pickupReturnTime` stays `string` HH:mm.

**Known risk:** touches the no-overlap/canChain invariant. Back-compat rests on `waitAtDestination ?? true` + `dropOffDone null ⇒ one interval`; T5/T6/T7 must keep all existing rule tests green, and the T10 simulate gate must stay 0.
</content>
