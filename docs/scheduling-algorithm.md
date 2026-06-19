# Scheduling & assignment algorithm

How the system decides **which driver (and therefore which car) does which trip**.
This is the reference for the matcher, the batch solver, the eligibility rules,
and the duty-overlap rule.

> **car = driver.** Every active car has exactly one assigned driver
> (`Vehicle.assignedDriverId`). Picking the driver *is* picking the car — there
> is no separate vehicle search. A driver with no car can't be dispatched
> (`NO_SLOT`).

---

## 1. Core concepts

| Term | Meaning |
|------|---------|
| **Job type** | `TJW`, `OT`, `WERN`, `NORMAL`, `SMUS` (`SMUS` defined but unused). Auto-classified from the trip; `WERN` is duty and comes from `OnCallShift`, never the classifier. |
| **Duty / on-call / WERN driver** | The day's driver in `OnCallShift` for that date. Runs campus rounds 08:00–16:00. **Reserved all day** — excluded from every normal pick. |
| **Long trip** | `estimatedDistance > 400 km` (`LONG_TRIP_KM`). Needs a **secondary** (co-)driver. |
| **Rotation** | Per-category "who went longest ago" ledger: `lastTjwAt`, `lastOtAt`, `lastDutyAt`. |
| **Fairness ledger** | Duration-weighted `earningsScore` over a 30-day window (`FAIRNESS_WINDOW_DAYS`); tie-break after rotation. |

### Key constants

| Constant | Value | Source |
|----------|-------|--------|
| `WORK_DAY_START_HOUR` | 08:00 | `classification.ts` |
| `WORK_DAY_END_HOUR` | 16:00 | `classification.ts` |
| `MAX_JOBS_PER_DAY` | 2 | `rotations.ts` |
| `MORNING_END_HOUR` | 12:00 | `rotations.ts` |
| `TWO_HOUR_BUFFER_MS` | 2 h | `rotations.ts` |
| `LONG_TRIP_KM` | 400 | `classification.ts` (re-exported by matching/batch-solver) |
| `TJW_DAY_HOURS` | 12 | `classification.ts` |
| `FAIRNESS_WINDOW_DAYS` | 30 | `earnings.ts` |

---

## 2. Job classification (`classification.ts`)

`classifyJobType({ startAt, endAt, outOfProvince })`, in order:

1. `outOfProvince && overnight` → **TJW**
2. `overnight` (same area, crosses midnight) → **OT**
3. starts before 08:00 → **OT**
4. ends after 16:00 (or exactly 16:00 with minutes/seconds) → **OT**
5. otherwise → **NORMAL**

`overnight` = end falls on a later **local** calendar day. A Bangkok trip that
crosses midnight is OT, **not** TJW (out-of-province is required for TJW).

`WERN` is never produced here — it's the duty driver, driven by `OnCallShift`.

---

## 3. Fairness & rotation (`rotations.ts`, `classification.ts`)

**Effort** credited to the ledger per trip (`tripEffort`):
- `WERN` → **0** (duty handled by its own rotation)
- `TJW` → `spanDays × 12` (a 3-day away-trip = 36 h)
- everything else → real duration in hours

**Rotation pick** (same for TJW/OT/WERN): among **eligible** drivers, take the
**oldest** category timestamp (`null` = oldest, so new drivers go first). Ties →
`earningsScore` ascending → `lastAssignedAt` ascending → `driverId`.

**NORMAL** uses a coverage rule instead of a timestamp: lowest `earningsScore`
first, and everyone with 0 **NORMAL** trips today is served before anyone gets a
2nd (`pickGeneralRank`, tier-0 before tier-1). The tier count is NORMAL-only, so
an OT a driver already holds doesn't push them out of the NORMAL pick.

---

## 4. Eligibility — can a driver take this trip? (`rotations.ts:canChain`)

**Job-type-aware.** The single rule shared by **both** assignment paths
(`canTake` in the solver, `canTakeTrip` → `filterAvailable` in the matcher);
`jobType` defaults to NORMAL for untyped callers.

- **No overlap** with any existing same-day trip.
- **≥ 2h gap** between the new trip and *every* existing trip
  (`next.end + 2h ≤ e.start` **or** `e.end + 2h ≤ next.start`) — universal, all
  job types. E.g. an OT ending 06:00 lets an 08:00 job follow; ending 06:30 blocks it.
- **NORMAL cap:** at most **2** NORMALs, and they must be one **morning**
  (ends ≤ 12:00) + one **afternoon** (starts ≥ 12:00). Two mornings, two
  afternoons, or a midday straddler (starts <12 & ends >12) + another are rejected.
- **OT is exempt from the cap** (extra hours on top) but still obeys the 2h gap —
  a driver can stack early-bird OT + morning + afternoon NORMAL + evening OT as
  long as every pair keeps the gap.
- **TJW** locks the driver away for the trip span; **WERN** = the reserved duty driver.

"Existing trips" = the driver's other **same-day** commitments — so the batch
path must load already-assigned trips (`existingByDriver`, §6b).

---

## 5. The no-overlap rule

**No car may ever be double-booked — not even the duty car.** Overlap is the one
constraint a manual override can NOT relax: an admin drag/assign may break the 2h
chaining gap (P'Top's call), but never put two trips on the same car at the same
time. The duty driver is still **reserved** (excluded from every auto pick) and a
WERN reclaim is handled by freeing the duty car first (unassign WERN — drag it
back to the queue — then assign the reclaimed trip), so the duty car never needs
to overlap.

Enforced in three places:

- **Matcher / solver picks** exclude the duty driver entirely
  (`matching.ts:54`, `batch-solver.ts:eligibleForPrimary`), so the duty car never
  receives a normal auto-assignment.
- **Drag-drop / assign-reco** (`schedule-actions.ts:reassignVehicleAction`)
  blocks an overlapping drop on **every** car (the 2h gap is not checked here, so
  it stays overridable). Re-dropping on the same car is the only skip.
- **Board** (`scheduler-board.tsx`) stacks concurrent blocks into lanes; any
  overlap on **any** car (duty included) gets a red conflict ring.

---

## 6. Two assignment paths

### 6a. Single-booking matcher — `match()` (`matching.ts`, driven by `matching-actions.ts`)

Used for one approved booking (auto-match button / drag).

1. Build **availability**: each driver's same-day trips. The on-call driver also
   gets a pseudo-trip **08:00–16:00** so `canTakeTrip` blocks overlapping regular
   jobs (`matching-actions.ts:110-116`).
2. **Eligible** = drivers who pass `filterAvailable` **and are not** the on-call
   driver (`matching.ts:53-54`).
3. **Rank** (`rankCandidates`): `earningsScore` ↑, `tripsThisMonth` ↑,
   `lastAssignedAt` ↑, then `driverId` (final tie-break for determinism).
4. **Primary** = top ranked. Its car = `driverCar.get(primary)`; no car →
   `NO_SLOT`.
5. **Long trip (> 400 km)** → also take rank #2 as **secondary**; none →
   `NO_SECONDARY_DRIVER`. The co-driver rides in the primary's car (no 2nd car).

### 6b. Batch solver — `solveDay()` (`batch-solver.ts`, driven by `batch-actions.ts`)

Solves the whole day's APPROVED-unassigned bookings at once.

**Inputs** built by `batch-actions.ts`:
- driver rotation snapshots + 30-day weighted `earningsScore`
- `dutyDriverId` from `OnCallShift`
- `activeTjwCommitments` — multi-day TJW trips spanning today → driver is
  `awayOnTjw` (locked out) or a same-day **returnee** (Phase-C OT only)
- **`existingByDriver`** — every trip already assigned for the day (primary +
  secondary), used to seed each driver's `scheduledToday` so `canTake` sees prior
  commitments. *Without this the solver double-books already-busy cars.*

> Both inputs — plus the `earningsScore` loader — count a booking as committed
> when its status is in `COMMITTED_STATUSES` (**APPROVED** \| ASSIGNED \|
> COMPLETED), not just ASSIGNED\|COMPLETED. A trip *claimed* via the board matcher
> stays APPROVED with a driver set; counting it stops a still-away driver from
> being re-picked and from looking idle in the fairness ledger.

**Order** — strict category priority (FCFS within each, by `submittedAt`):

```
TJW → OT → WERN → NORMAL → SMUS
```

(or pure global FCFS when `fcfsOverridesCategoryPriority` is set).

**Per booking** (`placeBooking`):
1. `eligibleForPrimary` = drivers that are **not** away-on-TJW, **not** the duty
   driver, under the **NORMAL-only** cap (OT is exempt), on the right side of the
   Phase-C returnee split.
2. Rank by the category's rotation (`rankForCategory`); first who passes
   `canTake` (overlap/chain) wins.
3. Long trip → pick a secondary the same way (minus the primary).
4. Commit → push the trip into the driver's `scheduledToday` (and `awayOnTjw` for
   TJW).

**Phase C** — OT trips that overflowed with `NO_PRIMARY_DRIVER` get one retry
against TJW **returnees** who got back before 16:00.

**WERN reclaim** — if a long trip can't find a fresh secondary but **the duty
driver could fit**, it doesn't silently use them; it raises
`NEEDS_WERN_RECLAIM_DECISION` for the admin (`reclaim-decision-form`):
`RECLAIM_WERN` (move the duty driver onto the trip) or `OUTSOURCE`. Policy:
`ESCALATE` (default) / `AUTO_RECLAIM` / `PROTECT_WERN`.

**Provisional rotation stamping** — on success the solver bumps
`lastTjwAt` / `lastOtAt` / `lastDutyAt` so a same-day re-run doesn't re-pick the
same driver.

---

## 7. Other placement helpers

- **Drag-to-car free driver** (`driver-capacity.ts:pickFreeDriver`) — fairest
  non-duty driver who passes `canTakeTrip`, or none.
- **Overtime reco** (`overtime-reco.ts`) — for an OT booking waitlisted by the
  time-blind day-capacity gate: recommends the fairest non-duty car-driver unit
  actually free at the booking's real time. Gated by `canChain` with `jobType:
  "OT"` — the 2-job/day cap is **not** applied (OT is extra hours) but the 2h gap
  is. Advisory, pure, no I/O.

---

## 7b. Leftover handling — placement recommendation (`placement-reco.ts`)

When the solver can't auto-place a trip (saturated pool / everyone away / duty),
P'Top gets a one-click recommendation instead of just an overflow reason.

`recommendPlacement` (pure): the **fairest non-duty car that can _legally_ take
the trip** — filtered by the full `canChain` rule (no overlap, ≥2h gap to every
trip, NORMAL cap), job-type aware, so the reco **never suggests a rule-breaking
slot**. Only P'Top may break the gap, and only by dragging the trip there by
hand. → else the **duty car** as a `reclaim` suggestion → else `none`. For a
> 400 km trip it also recommends a **co-driver** = the next-fairest driver who can
legally take it (rides in the primary's car), or null when none.

`recommendForBookings` (`placement-reco-data.ts`) builds the pool — drivers +
their assigned car + same-day trips (incl. their `jobType`, and **APPROVED**
claimed trips via `COMMITTED_STATUSES`) + 30-day earnings + duty driver — and is
consumed by **both** the batch overflow list (`admin/batch/page.tsx`) and the
board queue (`scheduler-board.tsx`). Assign = `AssignRecoButton` →
`reassignVehicleAction`, which sets primary + optional co-driver, **blocks overlap
on every car** (no duty exception; the 2h gap stays overridable), and re-validates
the co-driver at assign time.

---

## 8. Board rendering (`scheduler-board.tsx` + `-blocks.tsx` + `-shared.ts`)

Split into three: `scheduler-board.tsx` (the `SchedulerBoard` container + DnD),
`scheduler-board-blocks.tsx` (`TimelineBlock` / `CoDriverGhost` / `QueueCard` /
`CarRow`), `scheduler-board-shared.ts` (types, job-type theme, axis/lane geometry).

Cars = rows, time = X-axis (00:00–24:00, auto-fit). Each car's trips are
**lane-packed** greedily: a trip joins the first lane whose previous trip ends at
or before it starts, else opens a new lane; row height = `lanes × 64px`. Blocks
are **tinted by job type** (TJW blue, OT amber, WERN emerald, NORMAL slate, both
themes) and show a **compact start–end** time (`08:00–12:00` → `08–12`; minutes
shown only when non-zero) that truncates inside the bar; the full time is in the
hover tooltip.

- **Multi-day trips** (`day-window.ts`): each trip is projected onto the *viewed*
  day with `daySpan` — clamped to the 0/24 axis, flagged `continuesBefore` /
  `continuesAfter`. A trip shows on **every** day it spans (overlap query, not
  start-in-day), with `↪ <departure date>` / `↩ <return date>` labels and a flush
  clipped edge. Month grids bucket via `daysSpanned`.
- **Overlap** on **any** car (duty included) gets a red conflict ring; co-driver =
  violet ring + a linked ghost on the co-driver's own car row.
- **DnD**: drag a queue card onto a car to assign; drag a scheduled block onto
  another car to reassign, or up to the **Unassigned** zone (a droppable) to
  unassign. Each block also has a hover **✕** (drag-free unassign →
  `unassignBookingAction`). Collision = `pointerWithin` → `rectIntersection`
  fallback with `MeasuringStrategy.Always` (the timeline scrolls horizontally).
  A rejected drop (overlap) returns the conflicting trip(s) (`ReassignConflict`)
  and the banner names each **with its date** (e.g. `VB-… · 18 Jun 09:00–11:00`),
  so a multi-day clash on a day that isn't on screen is visible.
- The unassigned queue carries each booking's placement recommendation (§7b) with
  an inline Assign.
- **Auto-assign button** (`จัดอัตโนมัติ {n}`) places the queue **and** resolves
  overlap conflicts among already-assigned trips. For every pair of PRIMARY trips
  double-booked on a car (the red ring, §5), the **loser** is re-matched to a
  free legal car via `recommendPlacement` (`fit` only). Loser rule
  (`conflict-resolve.ts`): **WERN/duty is pinned** — reserved all day (§1/§5), it
  is never the trip that moves, so a duty-car conflict frees the car by moving the
  *intruder* off, never by re-homing duty work; otherwise lower category priority
  (TJW>OT>NORMAL), tie → later-submitted. The duty car is **never** auto-reclaimed
  as a *destination* either; a loser with no free car is left in place and reported. Non-destructive, one pass (residual conflicts
  stay red → click again). Server: `resolveScheduleConflictsAction`. The badge
  count = unassigned/driverless + conflict losers.

---

## 9. Overflow reasons

| Reason | Meaning |
|--------|---------|
| `NO_PRIMARY_DRIVER` | No eligible driver (cap/overlap/away/all duty). OT may still be rescued by Phase C. |
| `NO_SECONDARY_DRIVER` | Long trip, no fresh co-driver, and the duty driver doesn't fit either. |
| `NEEDS_WERN_RECLAIM_DECISION` | Long trip staffable only by reclaiming the duty driver → admin chooses. |
| `NO_SLOT` | Picked driver has no assigned car (unpaired) → can't dispatch. |

---

## 10. Source map

| File | Responsibility |
|------|----------------|
| `lib/booking/classification.ts` | Job-type classifier, `tripEffort` |
| `lib/booking/rotations.ts` | `canChain`/`canTake`, rotation rankers, constants |
| `lib/booking/driver-capacity.ts` | `canTakeTrip`, `filterAvailable`, `rankCandidates`, `pickFreeDriver` |
| `lib/booking/matching.ts` | `match()` — single-booking decision |
| `lib/booking/matching-actions.ts` | Loads data, calls `match`, persists |
| `lib/booking/batch-solver.ts` | `solveDay()` — whole-day solver |
| `lib/booking/batch-actions.ts` | Builds solver inputs, persists assignments + overflow |
| `lib/booking/batch-demo-actions.ts` | Demo seed / simulate + full Clear-demo reset |
| `lib/booking/earnings.ts` | Shared duration-weighted fairness loader (`loadWeightedEarnings`); counts `COMMITTED_STATUSES` |
| `lib/booking/booking-status.ts` | `COMMITTED_STATUSES` = APPROVED \| ASSIGNED \| COMPLETED — a driver-bearing booking that counts as a real commitment (claimed trips included) |
| `lib/booking/rotation-stamp.ts` | Recompute a driver's category rotation stamp |
| `lib/booking/audit.ts` | `logTransition` — single audit-log writer for every status change |
| `lib/booking/day-window.ts` | `daySpan` / `daysSpanned` — project a (multi-day) trip onto a viewed day / its day cells |
| `lib/booking/overtime-reco.ts` | Advisory OT placement |
| `lib/booking/placement-reco.ts` | `recommendPlacement` — leftover/overflow suggestion, gated by `canChain` (pure) |
| `lib/booking/placement-reco-data.ts` | Server builder for the recommendation |
| `lib/booking/conflict-resolve.ts` | `findConflictLosers` / `pickConflictLoser` — which double-booked trip moves (pure) |
| `lib/booking/schedule-actions.ts` | Drag-drop reassign + `unassignBookingAction` (back to queue) + `resolveScheduleConflictsAction` (auto-resolve overlaps); blocks overlap on every car; co-driver re-validation |
| `components/admin/scheduler-board.tsx` | Board container + DnD (collision, queue droppable, unassign) |
| `components/admin/scheduler-board-blocks.tsx` | `TimelineBlock` / `CoDriverGhost` / `QueueCard` / `CarRow` |
| `components/admin/scheduler-board-shared.ts` | Board types, job-type theme, axis/lane geometry |
| `components/forms/assign-reco-button.tsx` | One-click assign-to-recommendation |

See also: `docs/superpowers/specs/2026-06-15-duty-car-overlap-rule-design.md`,
`docs/superpowers/specs/2026-06-15-job-type-aware-chaining-design.md`.
