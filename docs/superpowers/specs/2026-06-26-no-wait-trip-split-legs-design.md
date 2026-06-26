# Design — No-wait trip split into two legs (capacity-affecting)

**Date:** 2026-06-26
**Source:** supervisor request — when a booking's "driver waits at destination" option
is **No**, the scheduler shows the trip as two separate blocks (`รับ` drop-off leg +
`กลับมารับ` return-pickup leg) and the freed middle is real, bookable capacity.
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** Scheduling-core behavior + all day-view rendering. Touches the no-overlap /
`canChain` invariant — the project's most-churned rule. Read
`docs/scheduling-algorithm.md` before implementing.

---

## 1. Goal

Today a booking occupies one continuous interval `[startAt, endAt]` for **both**
rendering and all scheduling logic (matcher, solver, `canChain`, no-overlap), regardless
of the `waitAtDestination` flag (which is currently stored + shown on detail pages only).

When `waitAtDestination = false`, the driver drops passengers, **leaves**, and returns
later to pick them up. The car is genuinely free in between. This design makes that gap
**real bookable capacity**: the trip becomes **two intervals**, and another trip may be
placed in the gap.

### Decisions (from brainstorming)

- **Capacity-affecting**, not visual-only: `canChain`, no-overlap, the solver, and
  conflict-resolve all treat a no-wait trip as two intervals.
- **New explicit field** bounds leg 1 (no estimate/guess for a safety invariant).
- **Render on all 6 day-views** (board, admin day-calendar, admin + driver month grids,
  driver dashboard, batch ASSIGNED roster).

---

## 2. Existing state

- `Booking.waitAtDestination Boolean @default(true)` and `Booking.pickupReturnTime String?`
  (HH:mm) exist (migrations `20260624090000_wait_at_destination`). Consumed only by
  `lib/booking/schema.ts`, `lib/booking/actions.ts` (persist), `components/forms/booking-form.tsx`
  (input), and the two detail pages (display). **No scheduling logic reads them.**
- Block timing comes from `daySpan(startAt, endAt, …)` (`lib/booking/day-window.ts`) →
  `startHour`/`endHour`; the 6 day-views render one block per booking.
- No-overlap + 2h gap live in `canChain` (`lib/booking/rotations.ts`), the matcher
  (`matching.ts`), the batch solver occupancy (`batch-solver.ts`), `reassignVehicleAction`
  (`lib/booking/schedule-actions.ts`), and `conflict-resolve.ts`. All operate on a single
  `{startAt, endAt}` per booking. Rule doc: `docs/scheduling-algorithm.md` §4 (`canChain`),
  §5 (no-overlap).
- There is **no** "leg" concept anywhere today.

---

## 3. Data model (Prisma — migration required)

- **New:** `Booking.dropOffDone DateTime?` — end of leg 1 (driver free after the drop-off
  run). Null ⇒ single-interval trip.
- **New:** `TripTemplate.dropOffDone DateTime?` — template parity (nullable; copied to a
  booking the same way other template fields are).
- Migration is **additive** (nullable column, no rename, no backfill). Existing rows →
  `dropOffDone = null` ⇒ single interval ⇒ unchanged behavior.

`pickupReturnTime` stays `String?` HH:mm (leg-2 start, same calendar day). `dropOffDone` is
a `DateTime` for symmetry with `startAt`/`endAt` and so leg comparisons are plain Date math.

---

## 4. Validation & constraints

- **Same-day only.** A no-wait split requires leg 1 and leg 2 on the same calendar day as
  `startAt`. Multi-day / overnight (TJW) trips are **always wait** — `dropOffDone` ignored.
- zod (`newBookingSchema`, when `waitAtDestination = false`):
  - require `dropOffDone` and `pickupReturnTime`;
  - enforce ordering `startAt < dropOffDone < pickupReturnTime < endAt`;
  - all four on the same calendar day.
- When `waitAtDestination = true` (or `dropOffDone`/`pickupReturnTime` absent) →
  single interval; no new constraints.
- `pickupReturnTime` (HH:mm) is resolved to a `DateTime` on the booking's date when building
  leg 2 (helper in §5).

---

## 5. Core helper — `lib/booking/trip-legs.ts` (pure, single source of truth)

```ts
export type Interval = { startAt: Date; endAt: Date };

// One interval when the trip waits / lacks split data (back-compat); two intervals
// for a no-wait trip with a drop-off-done time. pickupReturnTime (HH:mm) is resolved
// onto the booking's calendar day for leg 2's start.
export function tripLegs(b: {
  startAt: Date;
  endAt: Date;
  waitAtDestination: boolean;
  dropOffDone: Date | null;
  pickupReturnTime: string | null;
}): Interval[];

// True if ANY leg of a overlaps ANY leg of b.
export function legsOverlap(a: LegSource, b: LegSource): boolean;

// Min gap (minutes) between any leg of a and any leg of b (for the 2h rule).
export function minLegGapMinutes(a: LegSource, b: LegSource): number;
```

`tripLegs` returns `[{startAt,endAt}]` unless `waitAtDestination === false && dropOffDone &&
pickupReturnTime`, in which case `[{startAt, dropOffDone}, {pickupReturnTimeOnDate, endAt}]`.
Pure, no I/O, fully unit-tested.

---

## 6. Rules made leg-aware (capacity)

Each switches from comparing `{startAt,endAt}` to iterating `tripLegs(...)`:

- **`canChain` (`rotations.ts`)** — overlap check uses `legsOverlap`; the **≥2h gap** uses
  `minLegGapMinutes` against every existing trip's legs. **Cap counting unchanged:** a split
  trip is **one** job (one booking) for the NORMAL one-morning + one-afternoon cap; a trip
  later dropped into the gap is a separate job, itself cap-checked.
- **Matcher (`matching.ts`)** + **batch-solver occupancy (`batch-solver.ts`)** — a driver/car
  is "busy" at a time only if that time falls inside one of the trip's legs; the gap is free,
  so the solver may place a fitting trip there (no new gap-seeking heuristic — it simply
  no longer treats the gap as occupied).
- **`reassignVehicleAction` (`schedule-actions.ts`)** + **`conflict-resolve.ts`** — the
  no-overlap block + conflict-loser detection compare legs (`legsOverlap`). The manual 2h-gap
  override behavior is preserved (override relaxes the gap, never the overlap).
- **Rule doc** `docs/scheduling-algorithm.md` §4–5 updated: define "leg", state overlap/gap
  are per-leg, and that a no-wait trip frees its middle for other trips.

No change to category **priority** (TJW → OT → WERN → NORMAL) or fairness weighting.

---

## 7. Rendering (all 6 day-views)

- `daySpan` (`lib/booking/day-window.ts`) gains a leg-aware path: callers project **each leg**
  onto the viewed day (each leg clamps to the 0/24 axis + carries its own
  `continuesBefore`/`continuesAfter`). A single-interval trip is unchanged (one leg).
- The 6 consumers render **one block per leg**: scheduler board (`scheduler-board*`), admin
  day-calendar, admin month grid, driver month grid, driver dashboard, batch ASSIGNED roster.
- Board blocks: leg 1 tagged `รับ`, leg 2 tagged `กลับมารับ` (i18n keys, en+th). Both blocks
  carry the same booking id; DnD / tap-to-open act on the whole booking (drag either leg moves
  the trip). The gap renders as empty track (droppable).
- Co-driver ghost + conflict ring logic render per-leg.

---

## 7.1 Placement simulator (`/admin/simulate`)

The what-if placement simulator (`components/admin/simulate-form.tsx` +
`simulatePlacementAction` in `lib/booking/simulate-actions.ts`) runs one synthetic
booking through `solveDay`. Extend it to simulate a no-wait split:

- Form gains a "driver waits" toggle + `dropOffDone` and `pickupReturnTime` time inputs
  (shown when **not** waiting), mirroring the booking form. Same ordering/same-day rule.
- `simulatePlacementAction` reads the three fields, resolves them onto the chosen day, and
  puts them on the synthetic `SolverBookingInput`. The existing-trips query (`assignedToday`)
  also selects the three fields so an **existing** no-wait trip's gap is honored in the sim.
- Because `solveDay`/`canChain` are leg-aware (§6), the sim then shows where a split trip
  lands (or that it fits a car whose only busy windows are around an existing trip's legs) —
  the same `SimResult` shape (car·driver / overflow reason).

## 8. Testing

- **Unit:** `trip-legs.test.ts` — 1-interval (wait / legacy / missing data) vs 2-interval;
  `legsOverlap` true/false across leg combinations; `minLegGapMinutes`; HH:mm→date resolution.
- **Unit:** extend `rotations`/`canChain` tests — a trip fits in a no-wait gap (overlap=false,
  gap≥2h to both legs); overlapping a leg is rejected.
- **Unit:** `solver-invariants` — no leg double-booked; a gap-filling placement is legal.
- **Integration (DB):** extend the no-double-book tests (`schedule-actions.test.ts`) — drop a
  trip into a gap succeeds; drop overlapping a leg is blocked.
- **Scenario:** `npx tsx scripts/simulate-cr07.ts --scenario=<mixed|...>` rule-check counters
  stay **0**; add a no-wait case to the simulation generator if cheap.
- **zod:** ordering + same-day + required-when-no-wait.

---

## 9. Out of scope

- Auto-solver **actively seeking** gaps to optimize fill (it will *use* a gap when a trip fits,
  but no new gap-hunting heuristic).
- No-wait on **multi-day / overnight (TJW)** trips — always wait.
- Long-haul **>400 km co-driver** leg modeling beyond rendering per-leg.
- Requester-facing capacity display (this is a board/admin scheduling change).

---

## 10. Affected files (anticipated)

- `prisma/schema.prisma` (+ migration): `Booking.dropOffDone`, `TripTemplate.dropOffDone`.
- `lib/booking/trip-legs.ts` (new) + `trip-legs.test.ts` (new).
- `lib/booking/schema.ts`: `dropOffDone` + no-wait ordering/same-day refine; template schema.
- `lib/booking/actions.ts`: persist `dropOffDone` (create + recurrence) + template apply/save.
- `lib/booking/rotations.ts` (`canChain`), `matching.ts`, `batch-solver.ts`,
  `schedule-actions.ts`, `conflict-resolve.ts`: leg-aware overlap/gap.
- `lib/booking/day-window.ts` (`daySpan`): leg-aware projection.
- 6 day-view renderers: `components/admin/scheduler-board-{blocks,shared,*}.tsx`,
  `app/(admin)/admin/{schedule,calendar}/page.tsx`, admin/driver month grids,
  driver dashboard, batch roster.
- `components/forms/booking-form.tsx`: `dropOffDone` input shown when "no wait".
- `components/admin/simulate-form.tsx` + `lib/booking/simulate-actions.ts`: no-wait toggle +
  `dropOffDone`/`pickupReturnTime` inputs; synthetic booking + existing-trips query carry the
  leg fields (§7.1).
- `messages/{en,th}.json`: `รับ` / `กลับมารับ` leg labels + drop-off field labels.
- `docs/scheduling-algorithm.md`: §4–5 leg-aware rule update.
- Tests under `lib/` + `tests/`.

## 11. Self-review notes

- Back-compat: `dropOffDone = null` ⇒ `tripLegs` returns one interval ⇒ every rule + view
  behaves exactly as today. Zero behavior change for existing/waiting trips.
- Safety: no-overlap now rests on a stored `dropOffDone` (not an estimate); the gap can only
  open when the requester explicitly entered all four ordered times.
</content>
