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
| `LONG_TRIP_KM` | 400 | `matching.ts` |
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
first, and everyone with 0 trips today is served before anyone gets a 2nd
(`pickGeneralRank`, tier-0 before tier-1).

---

## 4. Eligibility — can a driver take this trip? (`rotations.ts:canChain`)

The single rule shared by **both** assignment paths (`canTake` in the solver,
`canTakeTrip` → `filterAvailable` in the matcher):

```
0 existing trips today                          → CAN take
≥ 2 existing trips today (MAX_JOBS_PER_DAY)      → CANNOT
overlaps an existing trip                        → CANNOT   (hard, always)
otherwise allowed ONLY as a morning→afternoon chain:
  one of the two trips ends strictly before 12:00,
  AND there is a ≥ 2 h gap between them
  (a long midday trip that ends ≥ 12:00 blocks a 2nd trip)
```

"Existing trips" = the driver's other **same-day** commitments. This is why the
batch path must load already-assigned trips (see §6).

---

## 5. The duty (WERN) overlap rule

**Only the duty car may hold overlapping trips. Every other car must never be
double-booked.** Rationale: the on-call driver carries a full-day WERN
reservation *plus* any trip "reclaimed" onto them; nobody else may stack trips.

Enforced in three places:

- **Matcher / solver picks** exclude the duty driver entirely
  (`matching.ts:54`, `batch-solver.ts:eligibleForPrimary`), so the duty car
  never receives a normal auto-assignment — it can only gain a trip via WERN
  reclaim. That makes it the *only* car that can overlap.
- **Drag-drop** (`schedule-actions.ts:reassignVehicleAction`) blocks an
  overlapping drop on any car **except** the duty car (looked up from
  `OnCallShift` for the booking's day).
- **Board** (`scheduler-board.tsx`) stacks concurrent blocks into lanes so the
  duty car's allowed overlap is visible; any overlap on a **non-duty** car gets
  a red conflict ring (should not occur after the solver fix — flags stale data).

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
   driver, under the 2-job cap, on the right side of the Phase-C returnee split.
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
  actually free at the booking's real time. The 2-job/day cap is **not** applied
  (OT is extra hours on top of the normal day). Advisory, pure, no I/O.

---

## 8. Board rendering (`scheduler-board.tsx`)

Cars = rows, time = X-axis (00:00–24:00, auto-fit). Each car's trips are
**lane-packed** greedily: a trip joins the first lane whose previous trip ends at
or before it starts, else opens a new lane; row height = `lanes × 64px`. Overnight
trips use `endHour = 24` as the right-edge sentinel. Non-duty overlaps get a red
ring.

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
| `lib/booking/overtime-reco.ts` | Advisory OT placement |
| `lib/booking/schedule-actions.ts` | Drag-drop reassign + duty overlap exception |
| `components/admin/scheduler-board.tsx` | Timeline board, lane stacking, conflict ring |

See also: `docs/superpowers/specs/2026-06-15-duty-car-overlap-rule-design.md`.
