# Design: job-type-aware chaining (2h gap + NORMAL morning/afternoon, OT uncapped)

Date: 2026-06-15

## Rule

Priority (assignment order) is unchanged: **TJW → OT → WERN → NORMAL**; NORMAL
fills leftover capacity.

Per-driver eligibility — a driver may take `next` given their existing same-day
trips when ALL hold:

1. **No overlap** with any existing trip.
2. **≥2h gap** between `next` and every existing trip:
   `next.end + 2h ≤ e.start` OR `e.end + 2h ≤ next.start`. (Universal — all job
   types.) Example: an OT ending 06:00 lets an 08:00 job follow; ending 06:30 blocks it.
3. **NORMAL cap** (applies only when counting NORMAL day-jobs): at most **2**
   NORMALs, and they must be **one morning + one afternoon** —
   morning = ends ≤ 12:00, afternoon = starts ≥ 12:00. A NORMAL that straddles
   noon (starts <12 and ends >12) is "midday" and is the only NORMAL allowed that
   day. Two mornings or two afternoons are rejected.
4. **OT is exempt from the cap** (extra hours on top) but still obeys rule 2. A
   driver can stack early-bird OT + morning NORMAL + afternoon NORMAL + evening
   OT, as long as every pair keeps the 2h gap.
5. **TJW** locks the driver away for the trip span (unchanged). **WERN** = the
   reserved duty driver (unchanged; only the duty car may overlap).

## Code changes

- **`rotations.ts`** — rewrite `canChain`/`canTake` to take the new trip's
  `jobType` and each existing trip's `jobType` (`ScheduledTrip` already has it).
  New logic: reject overlap or any pair <2h; then if `next` is NORMAL enforce the
  ≤2 morning+afternoon cap (OT/TJW/WERN: no cap). `MAX_JOBS_PER_DAY` now bounds
  NORMAL day-jobs.
- **`driver-capacity.ts`** — `TripWindow` gains `jobType`; `canTakeTrip`,
  `filterAvailable`, `pickFreeDriver` thread it through.
- **`batch-solver.ts`** — `canTake` call sites pass `booking.jobType`;
  `eligibleForPrimary` drops the coarse `scheduledToday.length >= 2` pre-filter
  (the cap now lives in `canChain`, which exempts OT). The WERN-reclaim duty-fit
  check uses `canTake` as before.
- **`matching-actions.ts`** — `tripsByDriver` entries carry `jobType`; the
  on-call pseudo-trip is tagged `WERN`; the new trip passes `booking.jobType`.
- **`simulation.ts`** — pass `jobType` into `canTake` if it calls it.

## Verification

- New `rotations` unit tests: morning+afternoon NORMAL allowed; 3rd NORMAL / two
  mornings rejected; OT-on-top allowed with 2h gap; OT without 2h gap rejected;
  OT does NOT consume a NORMAL slot.
- Update existing `rotations`/`driver-capacity` tests for the new signatures.
- `npx tsc --noEmit`; full `vitest run --no-file-parallelism`; re-run the 7
  `simulate-cr07` scenarios (rule checks stay 0).
