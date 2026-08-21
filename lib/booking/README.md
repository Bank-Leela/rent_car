# `lib/booking/` — the dispatch subsystem

106 files: 60 source modules and 46 co-located `*.test.ts`. Nearly every
behavioural change to this app lands here. The rules themselves are specified in
[`docs/scheduling-algorithm.md`](../../docs/scheduling-algorithm.md); this file
is only the map of where they are implemented.

Two facts shape everything below. **Car = driver** — a booking's vehicle is its
primary driver's `Vehicle.assignedDriverId` car, so picking the driver *is*
picking the car; there is no independent vehicle search. And **drivers are
passive** — there is no per-driver login in practice, only a shared kiosk account
matched by allowlist (`lib/auth/station.ts:15`, `DRIVER_STATION_EMAILS`), so
every path here is driven by the admin (P'Top), by approval, or by the nightly
sweep — never by a driver claiming work.

## The three dispatch paths

A maintainer will confuse the first two. They are different code, reached from
different buttons, and they can be made to disagree.

| Path | Entry point | Scope | Reached from |
|------|-------------|-------|--------------|
| **Batch solver** | `batch-actions.ts:25` → `batch-core.ts:58` → `batch-solver.ts:164` (`solveDay`) | one whole day, all its pending bookings, in priority order | `/admin/batch` → "เริ่มจัดรอบ" (`components/forms/batch-run-form.tsx:69`); `approveDocumentAction` (`approval-actions.ts:270`, calls it at `:316`); the nightly sweep (`app/api/cron/run-batch/route.ts:51,90`) |
| **Single matcher** | `matching-actions.ts:29` → `matching.ts:61` (`match`) | exactly one booking | `/admin/[id]` → "จับคู่อัตโนมัติ" (`components/forms/matching-form.tsx:23`); the board's "จัดอัตโนมัติ {n}" button, **one call per queued booking** (`components/admin/scheduler-board.tsx:276`) |
| **TJW by request order** | `tjw-request-actions.ts:31` → `tjw-request-solver.ts:63` | all pending TJW, globally, cross-day | `/admin/batch` → "จัด ตจว" (`batch-run-form.tsx:58`) |

จัด now runs **on approval**, so the cron is a safety net rather than the primary
trigger: `?date=` solves exactly that day (`route.ts:51`), and with no parameter
it sweeps every day inside `CRON_SWEEP_HORIZON_DAYS = 60` (`route.ts:23`) that
still has solvable work (`route.ts:90`).

The board's bulk button is **not** the batch solver. `autoAssignAll`
(`scheduler-board.tsx:260`) loops the not-fully-assigned rows
(`scheduler-board.tsx:113-115`: no car, or a car with no driver) and calls the
*single matcher* for each unplaced booking (`:276`) — or `reassignVehicleAction`
when the booking already sits on a car (`:274`). So the same screen can produce a
different day than จัดรอบ would, because the matcher decides one booking at a
time against the state left by the previous one, while `solveDay` decides all of
them against one snapshot.

TJW is deliberately outside the day solver: `BATCH_SOLVABLE_WHERE`
(`batch-core.ts:36`) takes only `status: "APPROVED"` with `primaryDriverId: null`,
and excludes jobTypes `TJW` and `SMUS`, `isEmergency` (urgent stays APPROVED for
manual matching), and `preferredVehicleType: "BUS_OUTSOURCED"`. That predicate is
exported because the cron sweep must ask the *same* question — asking a broader
one once made days that could never clear pile up on the sweep forever.

### How the two differ, concretely

- `solveDay` is **pure** — inputs in, assignments and overflow reasons out. All
  I/O (loading drivers, the duty roster, TJW spans, persistence) is in
  `batch-core.ts`; `runBatchAction` is only the ADMIN auth wrapper, which is why
  the cron can call the core directly with a resolved admin as audit actor.
- `match()` is pure too, but thinner: it has a WERN short-circuit
  (`matching.ts:65` — the day's duty driver gets the trip, but only if their car
  is genuinely free; if it is busy it falls *through* to the general pick, which
  excludes the duty driver, exactly as the solver does), then a single fair pick.
  It has no phases, no FCFS ordering, no Phase-C retry.
- `solveDay` orders by category (TJW → OT → WERN → NORMAL, FCFS by
  `submittedAt` inside each — `batch-solver.ts:184`; the
  `fcfsOverridesCategoryPriority` config flag makes it globally FCFS instead and
  defaults to false) and then runs **Phase C** (`batch-solver.ts:223`): OT trips
  that overflowed with `NO_PRIMARY_DRIVER` are retried against drivers returning
  from a TJW earlier the same day, before `WORK_DAY_END_HOUR = 16`
  (`classification.ts:18`, applied at `batch-solver.ts:160`).
- `runBatchForDay` **silently no-ops for a past day** (`batch-core.ts:81`) and
  returns zero stats. Backdated approval used to run the solver on a past date,
  invent a driver for a trip that had already happened, and stamp that driver's
  fairness clock with the trip's own past date.
- Persistence is **one transaction per assignment**, not one per day
  (`batch-core.ts:231-257`). A single conflicting car used to roll back the whole
  day and record nothing to explain it; on the cron the uncaught throw escaped
  the per-day loop and killed every later day in the sweep. The write is a
  guarded `updateMany` on `{ status: APPROVED, primaryDriverId: null }`
  (`:282`), so a board drop made between solve and write is not overwritten.

Both write paths run the same two-pass vehicle-type fallback — requested type
first, then the same fairness order with no type condition — because the
requested car type is a preference, never a filter (§5b).

All three go through `fleetTypeFor` (`vehicle-type.ts:36`) to translate the
requested `PreferredVehicleType` into the fleet's own `VehicleType` before
comparing. **Never compare those two enums directly.** They share only `VAN` and
`PICKUP`, so a raw comparison looks right on two of five values and silently
matches nothing on `SEDAN_DEAN` and `TRUCK_6_WHEEL` — which is exactly what
`matching.ts` and `placement-reco.ts` did until 2026-08-21, while their own
comments claimed they matched the solver. `vehicle-type.test.ts` pins the
translation and asserts all three engines pick the same car.

### The manual path

Dragging a card on `/admin/schedule`, or clicking a placement recommendation,
goes through `schedule-actions.ts:38` (`reassignVehicleAction`) — not through
either solver. This is the one path that may relax the 2h chaining gap and may
place a trip on a driver marked off sick; those are deliberate admin overrides.
It may **never** double-book a car or a driver, so it carries its own inline
vehicle-overlap scan (`schedule-actions.ts:99-131`, skipped only when re-dropping
on the same car) *and* a check for the driver's commitments in *other* cars
(`:141-162`) — a co-driver rides in the primary's car, so their own car looks
free and no vehicle-keyed guard catches it. It also refuses a departed trip
(`:57`) and anything outside `DISPATCHABLE_STATUSES` (`:67`).

## Where the rules live

| Concern | File | Notes |
|---------|------|-------|
| Eligibility: `canChain`, the universal 2h gap, the NORMAL cap, `sharesCarWith` | `rotations.ts:141`, `:135` | `MIN_GAP_MINUTES = 120` (`:24`), `IN_CHULA_PAIR_WINDOW_MINUTES = 10` (`:34`), `MAX_JOBS_PER_DAY = 2` (`:35`). `endsByNoon`/`startsAfterNoon` (`:96`, `:97`) are exported so the simulator checks the *same* predicates — a verifier that restates a rule is a second rule. |
| Overlap truth: the no-wait leg split | `trip-legs.ts:28` (`tripLegs`), `:44` (`legsOverlap`), `:52` (`minLegGapMinutes`) | A no-wait trip with a drop-off time and a return time is **two** intervals, freeing the middle as real capacity. Every overlap and gap computation in the subsystem routes through here. |
| The §5c window bound | `vehicle-conflicts.ts:61` (`findVehicleConflicts`) | Postgres enforces no-double-book by two exclusion constraints (`WHERE (NOT "inChula")` and `"inChula" WITH <>`), so a pair of in-Chula rows matches **neither** at any distance. That bound exists only here. Two callers: `batch-core.ts:266`, `matching-actions.ts:244`; `reassignVehicleAction` carries an equivalent scan inline. The TJW solver (`tjw-request-actions.ts:194`) and the leave hand-off (`leave-core.ts:300`) rely on the database EXCLUDE alone — which is exactly what cannot see §5c. A new write path must call this. |
| Per-driver capacity, availability, ranking | `driver-capacity.ts:86` (`canTakeTrip`), `:104` (`filterAvailable`), `:124` (`rankCandidates`), `:151` (`pickFreeDriver`) | `canTakeTrip` delegates to `canChain`; it is the single matcher's half of the same rule. |
| Job classification and effort weight | `classification.ts:54` (`classifyJobType`), `:91` (`tripEffort`), `LONG_TRIP_KM = 400` (`:21`), work day `8`–`16` (`:17`, `:18`) | |
| OT placement recommendation | `overtime-reco.ts:50` (`recommendOvertimePlacement`) | Advisory, pure. The day-capacity gate is time-blind and waitlists an OT that runs outside 08:00–16:00; this finds a car-driver actually free at the real time. Consumed by `queue-context.ts:127`. |
| Which statuses count | `booking-status.ts:17` (`COMMITTED_STATUSES`), `:36` (`DISPATCHABLE_STATUSES`) | `COMMITTED` includes `APPROVED` because a board-claimed trip stays APPROVED with a driver set — so **always pair it with a `primaryDriverId`/`secondaryDriverId` filter**, or a pending unassigned booking counts as a commitment. `DISPATCHABLE` excludes `COMPLETED` — a finished trip must not be re-dispatched. Never use them interchangeably. |
| WERN routing around away drivers | `duty-assignment.ts:21` (`resolveWernDriver`), `:42` (`pickAutoDutyDriver`); roster self-extension `duty-roster.ts:37` | Auto-rostering is **weekdays only** (§3a); an admin upsert may still write a weekend duty and readers honour any row that exists. |
| Submit-time / approval-time capacity | `slot-capacity.ts:48` (`dayCapacity`), `:60` (`submitStatus`); `approval-capacity.ts:72`, `:91` | Separate question from dispatch: these decide WAITLIST at submit and warn at approval. |
| Policy rules (lead time, work hours, buffers) | `rules.ts:80` (`checkLeadTime`), `:38` (`isWithinWorkHours`), `:149` (`findBufferConflicts`) | Not scheduling — request-validity rules used by the form and the approver. |
| Leave / sick day (§9b) | `leave-core.ts:318` (`applyLeaveDay`), `:474` (`clearLeaveDay`) | Which seat the absent driver held decides what moves. A trip already departed, or spanning in from an earlier day, is flagged for P'Top and never re-dispatched (`:415`). |

## The read-model files are not logic

Five modules look like scheduling code and are not. They are server-side loaders
that assemble exactly what one page renders, extracted so the page stays a thin
view. Changing them changes what is *shown*, not who gets a trip.

| File | Feeds | Owns |
|------|-------|------|
| `timeline-board-data.ts:44` (`loadTimelineBoard`) | `/admin/schedule` timeline | the whole day → board mapping, incl. `SYNTHETIC_SMUS_ROW_ID` (`:42`), a display-only lane with no `AdHocVehicle` behind it |
| `queue-context.ts:50` (`loadQueueContext`) | `/admin` queue | OT placement recos, triage flags, the SLA-overdue count |
| `detail-context.ts:54` (`loadBookingDetailContext`) | `/admin/[id]` | assignable-vehicle list with buffer flags, repeat-canceller warning, decision context |
| `placement-reco-data.ts:14` (`recommendForBookings`) | `/admin/batch` overflow list, board queue, `approval-capacity.ts:109` | server-side builder for `placement-reco.ts:86` |
| `driver-rounds.ts:119` (`buildDriverRounds`) | `/driver/schedule` whiteboard | the depart/away/return round phases the kiosk board paints |

One honest exception: `placement-reco-data` output becomes the `vehicleId` that
`AssignRecoButton` posts to `reassignVehicleAction`, so a bad recommendation
becomes a real assignment with one click. `recommendPlacement` is therefore
gated by the same `canChain` the solver uses (`placement-reco.ts:93`, `:116`) —
it must never suggest a slot the rules forbid. Only P'Top may break a rule, by
dragging the trip there by hand.

## Actions, by job

| File | Owns |
|------|------|
| `actions.ts:17` | the shared `ActionResult` type; `assignBookingAction` (`:29`), `denyBookingAction` (`:124`) |
| `create-booking-action.ts` | the submit path. **`jobType` is gated here** (`:84`): a non-admin's submitted `jobType` is discarded and the classifier's answer used — except `SMUS`, which the form legitimately declares and which stays requester-settable. |
| `approval-actions.ts:270` (`approveDocumentAction`), `:69,329,472+` | approve / deny / document confirm, single and series |
| `batch-actions.ts:25,41,70` | the จัดรอบ auth wrapper, cancellation rollback, and `resolveReclaimAction` — P'Top's answer to a `NEEDS_WERN_RECLAIM_DECISION` overflow (RECLAIM_WERN actually moves the duty driver onto the trip; OUTSOURCE marks it for a vendor) |
| `schedule-actions.ts:38,278,371,466` | reassign vehicle, reassign co-driver, unassign, move times |
| `extra-actions.ts:22,131,220,325` | cancel, evaluate, record outsourcing, toggle needs-co-driver |
| `adhoc-actions.ts` | hired-vehicle board rows and outsourcing to them |
| `availability-actions.ts:54,83` | driver leave, single day and range (wraps `leave-core`) |
| `fleet-actions.ts:38` | the car↔driver pairing itself (plus vehicle CRUD, `:118,137,151`) |
| `driver-actions.ts:85,131` | start / end trip, from the `driverstation` kiosk |
| `batch-demo-actions.ts:218,262` | demo seeding and clear-down |
| `simulate-actions.ts:221,248` | read-only what-if placement through the real `solveDay` (`simulatePlacementAction`) **and** `bookSimulatedSlotAction`, which writes a real ASSIGNED booking on a real car. Both refuse unless `isSimulationEnabled()` (`lib/config/features.ts:6`; on in dev, in production only with `ENABLE_SIMULATION=true`) — hiding the button is not a guard, a server action is callable regardless. |

Helpers worth knowing: `fleet.ts:41` (`driverVehicleMap`), `db-errors.ts:9`
(`isExclusionViolation` — recognises SQLSTATE 23P01 in all the shapes Prisma
surfaces it), `audit.ts:10,45` (every status transition goes through
`logTransition`), `day-window.ts:32`, `series.ts`, `recurrence.ts`,
`booking-detail-include.ts` (kept separate so `"use server"` files stay
compliant with Next's all-exports-async rule).

## Rotation and fairness

Two independent clocks per driver, and they move apart on purpose:

- **General** — `Driver.lastAssignedAt`, the last assignment of any kind.
- **Category** — `lastTjwAt` / `lastOtAt` / `lastDutyAt`. NORMAL has no category
  clock (`rotation-stamp.ts:87-90` maps only TJW/OT/WERN to a field).

There are **three** rankers, and they are not the same order. Everywhere, `null`
counts as oldest so a new driver comes first, and `driverId` is the final
tie-break so a full tie is deterministic rather than DB-row-order dependent.

| Ranker | Order | Used by |
|--------|-------|---------|
| `rotations.ts:211` (`rankForRotation`) | category clock → earnings → `lastAssignedAt` → id | the solver's TJW / OT / WERN picks (`batch-solver.ts:385`) |
| `rotations.ts:199` (`pickGeneralRank`) | **earnings first** → `lastAssignedAt` → id | the solver's NORMAL pick, then re-tiered so everyone gets one NORMAL before anyone gets two (`batch-solver.ts:398-401`) |
| `driver-capacity.ts:124` (`rankCandidates`) | earnings → `tripsThisMonth` → `lastAssignedAt` → id | the single matcher only |

The `olderFirst` comparator (`rotations.ts:177`) is written as a total order
rather than arithmetic — two nulls once produced `NaN`, which makes `Array.sort`
treat the pair as equal *and* abandon every remaining tie-break.

`earnings.ts:12` (`loadWeightedEarnings`) is the one ledger all three deciders
rank by: `tripEffort`-weighted trips over `FAIRNESS_WINDOW_DAYS = 30` (`:10`),
counting `COMMITTED_STATUSES`.

**`stampRotationForward` (`rotation-stamp.ts:81`) has two rules, and both halves
have caused real bugs:**

1. **Forward only.** The guard is in the `WHERE` clause
   (`OR: [{ lastAssignedAt: null }, { lastAssignedAt: { lt: stamp } }]`), not
   read-then-write, so two concurrent assignments cannot both decide they are
   newer. A plain `update` sets whatever it is given, so stamping a *past-dated*
   trip drags the clock backwards and the driver then looks like the
   least-recently-used person in the fleet and wins the next several rotations
   they should have lost. This was measured on a nine-day-old backdated booking;
   see `backdated-dispatch.test.ts`.
2. **The category clock moves only when a `jobType` is passed** (`:101`), on its
   own forward condition. "Last TJW" and "last assignment of any kind" are
   different questions. The inverse function had the mirror bug:
   `recomputeRotationStamp` (`:15`) returned early for NORMAL and never restored
   `lastAssignedAt`, making cancellation rollback a no-op for the commonest job
   type in the system (`:42-46`). It also must query `COMMITTED_STATUSES` —
   missing `APPROVED` recomputed a claimed OT to `null`, and `null` sorts oldest,
   so the driver jumped to the front of the rotation while still holding the work.

`rollbackRotationStampsForBooking` (`batch-actions.ts:41`) is the cancellation
entry point into that recompute.

## Verifying a change here

Follow [`AGENTS.md`](../../AGENTS.md). In short:

```
make check                 # typecheck + lint + test — required after any .ts change
make sim                   # ALL seven scenarios; scheduling changes only
```

`make sim` runs `scripts/simulate-cr07.ts` across
`mixed normal ot tjw tight chain reclaim`, stopping at the first failing
scenario. Read its exit condition before you trust it: it fails on
`capViolations + bufferViolations + wernConflictDays`
(`scripts/simulate-cr07.ts:471-479`). **A green `make sim` proves legality, not
fairness.** The fairness spread and standard deviation are printed on the same
report (`:419`) but are not gated by anything — a change that gives one driver
every trip while respecting the cap and the gap passes cleanly. If your change
touches ranking, read those numbers by eye.

The tests that encode the rule are `rotations.test.ts`,
`solver-invariants.test.ts`, `batch-solver.test.ts`, `overtime-reco.test.ts`,
`trip-legs.test.ts`, and `in-chula-shared-car.test.ts`.

## Traps this directory has actually sprung

- **next-intl resolves keys at runtime.** `tsc` and `npm run build` cannot catch a
  missing `messages/th.json` key; a Thai user sees the raw key path. Note the two
  conventions here: `matching-actions` / `batch-actions` return *already
  translated* strings via `getTranslations`, while `schedule-actions` returns
  machine **codes** (`"vehicleBusy"`, `"noAssignedDriver"`,
  `"cannotAssignInStatus"`, `"tripAlreadyStarted"`, `"coDriverSamePrimary"`) that
  the client maps — `components/forms/assign-reco-button.tsx:31`,
  `components/admin/scheduler-board.tsx:161,190,281`. Every mapper ends in a
  generic `dropFailed`, so a new code that nobody adds a case for does not crash:
  it silently degrades to "วางงานนี้ไม่สำเร็จ" and the real reason is lost. Push
  the code through raw instead and the admin reads `cannotAssignInStatus` — that
  is the bug `autoAssignAll`'s mapper was added to fix.
- **zod `z.object` strips silently.** An undeclared FormData key vanishes with no
  error; a field that is declared but ungated is a privilege hole. `jobType` is
  still *declared* in `schema.ts:107` — it survives the strip pass — so the gate
  has to be explicit, and it is, at `create-booking-action.ts:84`. Until then a
  requester could post `jobType=TJW` and put an ordinary errand at the top of the
  queue with a claim on the duty car.
- **`@db.Date` columns are a day off, not merely UTC.** Three are affected:
  `OnCallShift.date`, `DriverUnavailability.date`, `AdHocVehicle.date`. Writers
  hand in local midnight; Prisma truncates to the **UTC** date part, so under
  +07 the stored calendar date is the day *before* the one intended and reads
  back as UTC midnight of that earlier date. Querying is safe (the query value is
  truncated identically). What is not safe is deriving a key from the value that
  comes back: `startOfDay(row.date)` and `format(row.date, "yyyy-MM-dd")` both
  give the stored day. Use `db-date.ts:41` (`dbDateKey`) to compare and `:61`
  (`localDayOfDbDate`) to display or iterate.
- **The >400 km co-driver rule usually does not fire.** `estimatedDistance` is
  filled only by an admin pressing the Maps lookup, which is gated on the API key
  (`distance-actions.ts:17`), so in a deployment without one it stays `null` and
  the manual `needsSecondaryDriver` flag is the *only* trigger. Every pairing
  site ORs the two; `recommendForBookings` takes the flag as a required field
  because three callers had simply omitted it.
- **The database is not the whole rule.** The exclusion constraints on
  `VehicleOccupancy` (filled by trigger `sync_vehicle_occupancy()`) cannot
  express the §5c window; that bound lives only in `vehicle-conflicts.ts`.

## The spec

[`docs/scheduling-algorithm.md`](../../docs/scheduling-algorithm.md) is the
authority: §4 eligibility, §5 no-overlap, §5b vehicle type, §5c the in-Chula
exception, §6 the assignment paths, §9b leave. Read it before changing any of
the hotspot files listed in `AGENTS.md`. **If the code and that document
disagree, the document is the spec and the code is the bug** — this subsystem has
churned precisely because the rule kept being re-derived from whatever the code
happened to do. Two known drifts: §6b's heading and the §10 source map (doc
lines 343 and 631) still credit `batch-actions.ts` with building solver inputs
and persisting, which moved to `batch-core.ts`; and §5b claims all three
placement engines compare vehicle type identically, which they do not (see
above). Use this README for *where*, the doc for *what*.
