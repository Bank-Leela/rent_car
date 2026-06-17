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
4. ends after 16:00 (or exactly 16:00 with minutes) → **OT**
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
   `lastAssignedAt` ↑.
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

`recommendPlacement` (pure): the **fairest non-duty car free at the trip's time**
(overlap blocks; the 2-job cap is *relaxed* — this is a manual override) → else
the **duty car** (`reclaim`, the only car allowed to overlap) → else `none`. For a
> 400 km trip it also recommends a **co-driver** = the next-fairest free non-duty
driver (rides in the primary's car), or null when none is free.

`recommendForBookings` (`placement-reco-data.ts`) builds the pool — drivers +
their assigned car + same-day trips (incl. **APPROVED**, to match the assign
action's conflict set) + 30-day earnings + duty driver — and is consumed by
**both** the batch overflow list (`admin/batch/page.tsx`) and the board queue
(`scheduler-board.tsx`). Assign = `AssignRecoButton` → `reassignVehicleAction`,
which sets primary + optional co-driver, allows the duty-car overlap for reclaim,
and re-validates the co-driver at assign time.

---

## 8. Board rendering (`scheduler-board.tsx`)

Cars = rows, time = X-axis (00:00–24:00, auto-fit). Each car's trips are
**lane-packed** greedily: a trip joins the first lane whose previous trip ends at
or before it starts, else opens a new lane; row height = `lanes × 64px`. Overnight
trips use `endHour = 24` as the right-edge sentinel. Blocks show **start–end**
time and are **tinted by job type** (TJW blue, OT amber, WERN emerald, NORMAL
slate, both themes). Conflict (red ring) and co-driver (violet ring + a linked
ghost on the co-driver's own car row) stay as overlays. Non-duty overlaps get a
red ring. The unassigned queue carries each booking's placement recommendation
(§7b) with an inline Assign.

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
| `lib/booking/earnings.ts` | Shared duration-weighted fairness loader (`loadWeightedEarnings`) |
| `lib/booking/rotation-stamp.ts` | Recompute a driver's category rotation stamp |
| `lib/booking/overtime-reco.ts` | Advisory OT placement |
| `lib/booking/placement-reco.ts` | `recommendPlacement` — leftover/overflow suggestion (pure) |
| `lib/booking/placement-reco-data.ts` | Server builder for the recommendation |
| `lib/booking/schedule-actions.ts` | Drag-drop reassign (+ duty overlap exception, co-driver) |
| `components/admin/scheduler-board.tsx` | Timeline board, lane stacking, job-type colours, queue reco |
| `components/forms/assign-reco-button.tsx` | One-click assign-to-recommendation |

See also: `docs/superpowers/specs/2026-06-15-duty-car-overlap-rule-design.md`,
`docs/superpowers/specs/2026-06-15-job-type-aware-chaining-design.md`.
