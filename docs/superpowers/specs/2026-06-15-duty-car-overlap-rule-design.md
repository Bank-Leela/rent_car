# Design: only the duty (WERN) car may overlap

Date: 2026-06-15

## Problem

On the scheduler board, non-duty cars show overlapping bookings. The business
rule is:

- **Non-duty car: never double-booked.** Two trips whose clock ranges overlap
  must never land on the same non-duty car/driver.
- **Duty (WERN) car: may overlap, and the overlap must be visible** on the board
  (the on-call driver carries a full-day WERN reservation plus any reclaimed
  trip).

## Root cause

`runBatchAction` (`lib/booking/batch-actions.ts`) builds each driver's solver
state from rotation snapshots only and seeds `scheduledToday: []`
(`lib/booking/batch-solver.ts:138`). The solver therefore does not know about
bookings already assigned to that driver/car earlier in the day. `canTake`'s
overlap guard (`lib/booking/rotations.ts:73`, "overlap always blocks") runs
against an empty schedule, so each batch Run can stack a new trip on top of an
existing one. Only spanning **TJW** trips are accounted for today (via
`awayOnTjw` / `activeTjwCommitments`).

The single-match path (`matchBookingAction`) already loads same-day trips
(`tripsByDriver`) and excludes the duty driver, so it is correct. The seed
creates bookings as APPROVED + unassigned; the overlaps are produced by the
solver at Run time, not pre-seeded.

## Changes

### 1. Solver — never double-book a non-duty car (root fix)

- `batch-solver.ts`: add optional `existingByDriver?: Map<string, ScheduledTrip[]>`
  to `SolverInput`. In `solveDay`, seed `scheduledToday` from a **copy** of that
  map's entry instead of `[]`.
- `batch-actions.ts`: query the day's already-assigned bookings
  (`status in [ASSIGNED, COMPLETED]`, `primaryDriverId != null`, overlapping the
  day window), build the map for both primary and secondary drivers, pass it in.

Effect: `canTake` sees the real schedule. A non-duty car already booked
overflows instead of overlapping (correct — the day is full). The duty driver is
already excluded from all picks, so it stays the only car that can hold overlap
(WERN reclaim). The `MAX_JOBS_PER_DAY` cap also becomes accurate.

### 2. Drag-drop — duty exception

`reassignVehicleAction` currently blocks overlap on every car (`vehicleBusy`).
Look up the booking's day's `OnCallShift.driverId`; if the target car's
`assignedDriverId` equals it, skip the overlap block. Non-duty drops on a busy
car still reject.

### 3. Board — stack concurrent blocks

`scheduler-board.tsx` `CarRow` renders every block in one flat lane. Replace with
greedy lane-packing: overlapping blocks get separate stacked sub-rows; row height
grows with lane count. The duty car's allowed overlap then shows both trips
instead of hiding one behind the other. Safety net: outline any overlap on a
**non-duty** car in red (should not occur after change 1; surfaces stale data
from past runs).

## Out of scope

- Retroactively cleaning overlaps assigned by past runs (use Clear demo + Run).
- The single-match / auto-match path (already correct).

## Verification

- `npx tsc --noEmit`
- `npx vitest run lib/booking --no-file-parallelism` (new solver test + existing
  suite green)
- Board is UI-only; visual check that a duty car stacks and a non-duty car cannot
  be double-booked after a Run.
