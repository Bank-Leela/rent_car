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
| **Job type** | `TJW`, `OT`, `WERN`, `NORMAL` (`SMUS` = external charter — see §2). Auto-classified from the trip; `WERN` is duty — never produced by the classifier. It's forced at booking creation when `travelWithinChula` is set (in-Chula trip = a request for the duty car), and otherwise attaches via `OnCallShift`. |
| **Duty / on-call / WERN driver** | The day's driver in `OnCallShift` for that date. Runs campus rounds 08:00–16:00, **Mon–Fri only** (see §3a). **Reserved all day** — excluded from every *non-WERN* pick (TJW/OT/NORMAL). A **WERN-typed booking is routed TO them** (matcher, solver, and reco all special-case it); if no duty driver is rostered, or they're away/returning mid-day, WERN falls back to the duty rotation (oldest `lastDutyAt`). |
| **Long trip** | `estimatedDistance > 400 km` (`LONG_TRIP_KM`) **or** the admin's manual `needsSecondaryDriver` flag. Needs a **secondary** (co-)driver. Distance is usually unset in prod (Maps is env-gated), so the flag is the practical trigger — all three solvers (matcher, batch, TJW-request) OR the flag into the pairing condition. |
| **Rotation** | Per-category "who went longest ago" ledger: `lastTjwAt`, `lastOtAt`, `lastDutyAt`. |
| **Fairness ledger** | Duration-weighted `earningsScore` over a 30-day window (`FAIRNESS_WINDOW_DAYS`); tie-break after rotation. |

### Key constants

| Constant | Value | Source |
|----------|-------|--------|
| `WORK_DAY_START_HOUR` | 08:00 | `classification.ts` |
| `WORK_DAY_END_HOUR` | 16:00 | `classification.ts` |
| `MAX_JOBS_PER_DAY` | 2 | `rotations.ts` |
| `MORNING_END_HOUR` | 12:00 | `rotations.ts` |
| `MIN_GAP_MINUTES` | 120 | `rotations.ts` — enforced in `canChain` against `minLegGapMinutes` |
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

`WERN` is never produced here. It's set in two places only: `createBookingAction`
forces `jobType=WERN` when the booking has `travelWithinChula=true` (bypassing
`classifyJobType` — an in-Chula trip is a request for the duty car), and the
duty roster (`OnCallShift`) drives which driver serves it. This resolves the
old "keep both" merge: the hint-only `outsideChula` path is removed; UI chips
derive from `travelWithinChula`.

**`SMUS` (external charter) is LIVE again.** It was retired in `9ccc55a` and
restored in the commit that follows this doc change: the หลักสูตรนิสิตแพทย์ trip
area is back on the booking form as the fourth `พื้นที่เดินทาง` option, with its
`รถบัส (คัน)` / `รถตู้ (คัน)` counts, its 30-**calendar**-day lead-time tier
(weekends counted, unlike every other tier), and its filter chips.

It is still never produced by the classifier — the form sets `jobType=SMUS`
directly via a hidden input when that area is chosen, because the choice is the
requester's, not something derivable from the trip.

The `externalBusCount` / `externalVanCount` columns were never dropped, so the
restore needed no migration. The guards that hold a charter off an internal car
are load-bearing and always were — a charter is booked from an outside vendor
and must never be given a faculty car or driver:

| Guard | File | Why it stays |
|-------|------|--------------|
| `jobType: { notIn: ["SMUS", "TJW"] }` | `batch-core.ts` | keeps an old charter out of the daily batch |
| `jobType === "SMUS"` → refuse | `matching-actions.ts`, `schedule-actions.ts` | refuses to place one on an internal car |
| `filter(b => b.jobType !== "SMUS")` | `admin/schedule/page.tsx` | keeps one off the rounds board |
| `checkLeadTime` SMUS tier | `rules.ts` | the 30-calendar-day floor |

Removing any of them would make a charter eligible for a car and a driver.
`batch-solver.ts` deliberately has NO `SMUS` entry in its fill order: `batch-core`
filters the type out upstream, so an entry there would be dead code.

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

## 3a. The เวร roster is weekdays only (`duty-roster.ts`)

`ensureOnCallRosterThrough()` **auto-rosters Mon–Fri and never Saturday or
Sunday.** Campus rounds run 08:00–16:00 and the faculty does not run them at the
weekend; the rotation previously had no notion of a week, filled all seven days,
and so named a driver who was then "reserved all day" — excluded from every other
pick — for a duty that did not exist. Opening a Saturday still tops the roster up
**through the Friday before it**, so the days around the viewed one stay decided
and the cheap "already rostered?" exit keeps working (a weekend never has a row,
so testing the weekend itself would miss every time and re-run the fill loop on
every render). The rotation simply carries across the gap: Friday's duty driver
is followed by Monday's next-fairest, so the weekend costs nobody their turn.

**A manual override is still honoured on any day.** The admin upsert
(`matching-actions.ts`) writes whatever date it is given, and every reader keeps
using whatever row exists — a weekend duty for a special event is a decision
somebody made, not a gap the rotation filled. Only *auto*-rostering is bounded.
`scripts/prune-weekend-duty.ts` clears weekend rows the old rotation already
wrote (future days only — history is never backfilled, and it refuses any day
that has a WERN booking on it).

### The `@db.Date` trap that made this look worse than it was

`OnCallShift.date` is `@db.Date`. Writing local midnight of day D stores **D−1**
(measured: local `2027-03-01` → stored `2027-02-28`), and reading it back returns
that stored day. So:

- Comparing two **equally shifted** keys is correct — `dbDateKey(readBack)` vs
  `dbDateKey(localDate)`, which is what `duty-roster.ts` (leave days) and
  `queue-context.ts` (duty by day) do. Leave these alone.
- Comparing a read-back-derived key against a **real local day** is off by one.
  The driver calendar did this (`dbDateKey(s.date)` vs `format(day, "yyyy-MM-dd")`)
  and painted every เวร badge one cell early — a Monday duty appeared on the
  Sunday. Use `localDayOfDbDate()` to recover the true local day first.
- Deciding a **weekday** from the stored value is off by one for the same reason:
  `getDay()` of a Monday shift's stored value says Sunday. Any weekend check must
  go through `localDayOfDbDate()` — the first version of the weekday test, and of
  the prune script, both got this wrong and "found" weekend shifts that were
  Mondays.

Pinned by `lib/booking/duty-roster-weekday.test.ts`.

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
- **No-wait split (legs):** when `waitAtDestination = false`, a trip occupies **two
  intervals** — `[startAt, dropOffDone]` and `[pickupReturnTime, endAt]` — and its
  middle is **free**. Overlap and the 2h gap are evaluated **per-leg**, so another
  trip may sit in the freed gap (≥2h from each leg). A split trip still counts as
  **one** job for the NORMAL cap. All leg/overlap/gap math lives in
  `lib/booking/trip-legs.ts` (`tripLegs`/`legsOverlap`/`minLegGapMinutes`) — the
  single source of truth; a waiting trip (or one missing split data) is one interval,
  so existing behaviour is unchanged.

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

**"Same time" is per-leg** (see §4): a no-wait trip frees its middle, so two trips
on one car conflict only when a **leg** of each overlaps. The manual no-overlap
checks (reassign + conflict-resolve) compare legs via `lib/booking/trip-legs.ts`.

Enforced in three places:

- **Matcher / solver picks** exclude the duty driver entirely
  (`matching.ts:54`, `batch-solver.ts:eligibleForPrimary`), so the duty car never
  receives a normal auto-assignment.
- **Away-on-TJW never gets WERN** — a driver away on a multi-day TJW (primary OR
  co-driver) can't run campus duty. The solver excludes them via `awayOnTjw`; the
  single-booking matcher and the duty-roster auto-rotation enforce the same rule
  via `duty-assignment.ts` (`resolveWernDriver` falls a WERN back to the fairest
  present driver; `pickAutoDutyDriver` never rosters an away driver). A co-driver
  rides in the *primary's* car, so their own car stays free — the no-double-book
  rule can't catch this; the away-exclusion is the only guard.
- **Drag-drop / assign-reco** (`schedule-actions.ts:reassignVehicleAction`)
  blocks an overlapping drop on **every** car (the 2h gap is not checked here, so
  it stays overridable). Re-dropping on the same car is the only skip. It **also**
  rejects the drop when the target car's assigned driver is already committed on
  **another** car at that time (e.g. riding as a co-driver — their own car is free,
  so the per-vehicle EXCLUDE can't catch it); a driver overlap is never override-
  relaxable. Per-leg throughout (`trip-legs.ts`).
- No board paints a conflict ring any more (§8): an overlap on **any** car (duty
  included) is refused by the action, not drawn after the fact.

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
TJW → OT → WERN → NORMAL
```

(or pure global FCFS when `fcfsOverridesCategoryPriority` is set).

### TJW by request order (new-algorithm variant — `feat/new-algorithm`)

**TJW no longer goes through `solveDay`.** A dedicated pass
(`lib/booking/tjw-request-solver.ts` → `assignTjwByRequestOrder`) takes **all
pending APPROVED + unassigned TJW across every day**, sorts them strictly by
`createdAt` (tie-break `bookingId`), and assigns each the **fairest eligible
driver** (`rankForRotation` on `lastTjwAt` + earnings — the *same* driver-pick as
before). Each assignment provisionally bumps `lastTjwAt`, so the next request
falls to the next-fairest. So request *date*, not trip date, sets the order: a TJW
requested 25 Jun (trip 10 Jul) is assigned before one requested 26 Jun (trip 2 Jul).

- **Eligible** = car-paired, free across the trip's whole span, and not the duty
  driver on any day it spans. >400 km still pairs a co-driver.
- **Idempotent:** only *unassigned* pending TJW are placed; already-assigned TJW are
  **fixed commitments** (never reshuffled). Re-runnable.
- The daily batch query (`runBatchAction`) **excludes `jobType = "TJW"`**; `solveDay`
  still treats TJW-assigned drivers as away via `activeTjwCommitments`.
- **OT / WERN / NORMAL are unchanged** — still per-day `solveDay` with rotation/fairness.

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
driver could fit**, the `wernReclaimPolicy` decides (if the duty driver can't fit
either, it's a plain `NO_SECONDARY_DRIVER` regardless of policy):

- **`ESCALATE`** (default) — raise `NEEDS_WERN_RECLAIM_DECISION` for the admin
  (`reclaim-decision-form`): `RECLAIM_WERN` (move the duty driver onto the trip)
  or `OUTSOURCE`. The duty driver is never used silently.
- **`AUTO_RECLAIM`** — take the duty driver as the co-driver now (no escalation);
  for a TJW this locks them away for the span, abandoning duty rounds — the point.
- **`PROTECT_WERN`** — never reclaim; overflow `NO_SECONDARY_DRIVER` instead.

The default is `ESCALATE`, so production behaviour is unchanged; the other two
are opt-in via `SolverConfig`.

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
consumed by the batch overflow list (`admin/batch/page.tsx`) — the board queue
that also consumed it went with the timeline board (§8). Assign = `AssignRecoButton` →
`reassignVehicleAction`, which sets primary + optional co-driver, **blocks overlap
on every car** (no duty exception; the 2h gap stays overridable), and re-validates
the co-driver at assign time.

---

## 8. Board rendering (`driver-rounds-board.tsx` + `driver-rounds.ts`)

**Two boards, one page.** The whiteboard-style **rounds board** is the default on
both `/admin/schedule` and `/driver/schedule`. The drag-and-drop **timeline**
(`scheduler-board.tsx`, `-blocks.tsx`, `-shared.ts`, data in
`timeline-board-data.ts`) was deleted mid-cycle and **restored in `1f731f4`**:
the two answer different questions — the whiteboard says what is happening today,
the timeline is how you change it — so they sit behind a view switch rather than
one replacing the other. (This section previously said the timeline was gone; it
is not.) The timeline carries its own unplaced-trip tray, which is why
`/admin/schedule` hides the overflow bar while the timeline view is showing.

`lib/booking/driver-rounds.ts` is a **pure** view-model builder: drivers + the
viewed day's bookings → one row per car-paired driver, each holding that day's
rounds in start order. It decides nothing — assignment is unchanged.
`components/driver/driver-rounds-board.tsx` renders it; the kiosk gets it
read-only, the admin additionally gets a per-round move control.

One row per driver (car = driver), rounds flowing left→right as chips that wrap
as more are assigned. A same-day chip reads `start–end · place`.

- **Multi-day trips** carry a `phase`: `depart` (leaves today — `08:00 → ค้างคืน`),
  `away` (a middle night, dashed border, `คืนที่ 2/3`), `return` (comes back today
  — `กลับ 17:00`). Each says what is true on **this** day and pins the other end on
  the second line (`กลับ 13 ส.ค.` / `ออก 10 ส.ค.`). A trip appears on **every** day
  it spans (overlap query, not start-in-day). Month grids still bucket via
  `daysSpanned` (`day-window.ts`), which the calendar pages use.
- **Job-type tint**, both themes: ตจว blue, โอที amber, เวร emerald, and
  **ทั่วไป no fill at all** — colour means "not
  ordinary", and an outlined chip cannot be confused with dark-theme blue. A
  legend strip above the rows names each; its swatches reuse the chip and row
  classes, so the key cannot drift from what is painted.
- The **เวร driver's whole row** is tinted with a green edge stripe. The roster
  extends itself (`duty-roster.ts`), so a future day is already decided.
- **Moving one round**: admin-only per-chip control (`round-reassign.tsx`) →
  `reassignVehicleAction` / `unassignBookingAction`. The same server-side rules
  apply as before — overlap blocked on every car (no duty exception; the 2h gap
  stays overridable), per-leg co-driver re-validation — and a rejected move
  returns the conflicting trip(s) (`ReassignConflict`) **with their dates**, so a
  multi-day clash on a day that isn't on screen is still named. The board paints
  no conflict ring: a double-book is refused at the action, not drawn.
- **Dragging one round**: the rounds board is ALSO drag-and-drop on `/admin/schedule`
  (`rounds-dnd.tsx`), alongside the menu above — an earlier version of this section
  said the menu was the only way to move a trip on this board, which stopped being
  true. One `DndContext` spans the ยังไม่ได้จัดรถ bar, the driver rows and the hired
  outside rows, so a trip can cross between all three. Draggable ids are namespaced
  by where the trip currently sits (`p:` on a car, `q:` unplaced, `x:` on a hired
  vehicle) and droppables by what they are (`car:<vehicleId>`, `adhoc:<rowId>`, the
  queue) — the same vocabulary the timeline uses, deliberately.

  It decides **nothing new**: every drop posts to the action the menu posts to, so
  §5 still holds — overlap refused on every car including the duty car, the 2 h gap
  still overridable — and a refused drop raises the conflict as a toast rather than
  silently snapping back. As on the timeline, "dropped on neither a car nor a hired
  row" means unassign, because the queue box is a thin strip on a tall page and was
  unreliable to hit. Two deliberate exclusions: a **co-driver ghost** cannot be
  picked up (it rides in the primary's car, so a drop could not honour it — move the
  primary instead), and an **outsourced trip dropped on a car** only comes back
  in-house rather than landing on that car, since un-outsourcing and assigning are
  two decisions.

  Dragging is **admin-only and off by default** (`dnd` prop): the same component is
  the driver kiosk, and a driver reading their day must not be able to re-dispatch
  it. The timeline view renders without this provider — it brings its own.
- **Bulk assignment lives on `/admin/batch`** (`BatchRunForm` → `solveDay`), whose
  overflow list carries each booking's placement recommendation (§7b) with an
  inline `AssignRecoButton`. The timeline board ALSO has its own `autoAssignAll`
  (`scheduler-board.tsx`, the จัดอัตโนมัติ button) — an earlier version of this
  section said that button "went with the board", which stopped being true when the
  timeline board was restored.

  Neither path auto-resolves an overlap among already-assigned trips — that stays
  **manual** for P'Top, deliberately. An automatic loser-reassignment pass with
  WERN/duty pinning (`conflict-resolve.ts` / `resolveScheduleConflictsAction` /
  `findConflictLosers` / `pickConflictLoser`) was specced and then **dropped**; those
  symbols exist in no source file and are not pending work. Do not rebuild them from
  this paragraph — if automatic conflict resolution is wanted, it needs a fresh
  decision, not a resurrection.

---

## 9. Overflow reasons

| Reason | Meaning |
|--------|---------|
| `NO_PRIMARY_DRIVER` | No eligible driver (cap/overlap/away/all duty). OT may still be rescued by Phase C. |
| `NO_SECONDARY_DRIVER` | Long trip, no fresh co-driver, and the duty driver doesn't fit either. |
| `NEEDS_WERN_RECLAIM_DECISION` | Long trip staffable only by reclaiming the duty driver → admin chooses. |
| `NO_SLOT` | Picked driver has no assigned car (unpaired) → can't dispatch. |
| `DRIVER_OFF_NEEDS_REVIEW` | Not from a solver. Set when a driver goes off sick/on leave holding a trip §9b refuses to re-dispatch. |

---

## 9b. Driver leave / sick day (`leave-core.ts`)

Marked by ADMIN only — one day (a chip on the roster row) or a range
(`setDriverLeaveRangeAction`); every day in a range is settled independently,
since a five-day absence can meet five different เวร drivers and five different
trip sets. Drivers cannot mark themselves off.

`applyLeaveDay` writes the `DriverUnavailability` row and then settles four
things. All of it is idempotent — re-marking a marked day re-checks rather than
failing.

1. **เวร.** If that driver held the day's `OnCallShift`, re-pick it **directly**
   for that day. Do *not* defer to `ensureOnCallRosterThrough`: it tops the
   roster up from the last rostered day forward and no-ops in the middle of an
   already-written roster, leaving the day unmanned. Pool excludes anyone else
   off that day and anyone on a spanning multi-day ตจว. Nobody eligible → the
   shift is **deleted**, because an empty day is honest and a name that is on
   leave is not.
2. **Their trips → the เวร driver.** The agreed rule: the duty driver catches a
   dropped job. This is the one place the "duty driver is reserved all day" rule
   is deliberately overridden — being reserved is what makes them the catcher.
   Still gated by `canTakeTrip`; the no-overlap rule (§5) is never relaxed.
   Read the duty driver **after** step 1 or the work goes back to the person
   leaving.
3. **Which seat they held decides what moves.**
   - **Primary** → the whole trip goes to the เวร driver's car (`ASSIGNED`).
     Any existing co-driver is **kept** across the move — the window has not
     changed, so they are still free, and a > 400 km trip still needs them —
     unless they *are* the receiving driver, who cannot fill both seats.
     Nobody can take it → `APPROVED` + no car + `UNCLAIMED`, into the day's
     overflow bar.
   - **Co-driver only** → the primary and the car are **untouched**. Only the
     second seat is refilled (เวร driver, same catcher rule, no car needed since
     they ride in the primary's). Unfillable *and* the trip requires one
     (`needsSecondaryDriver` or > `LONG_TRIP_KM`) → `NO_SECONDARY_DRIVER` so it
     cannot sit on the board looking healthy.
4. **What is never re-dispatched.** A trip that **started on an earlier day** (a
   multi-day ตจว whose car is already out of province — handing its remaining
   legs to an on-campus เวร driver is nonsense) or one **already departed**
   (`trip.startedAt`, or `startAt` now past). Both keep their driver and are
   flagged `DRIVER_OFF_NEEDS_REVIEW` for P'Top. A trip already **finished** is
   left entirely alone. The scan is an **overlap** query, not start-in-day —
   the old start-in-day window could not see a trip spanning the leave day at all.

Rotation stamps are recomputed for every driver who gains or loses work, so
leave never credits work not done. Only trips left with **nobody** email the
requester: a trip that merely changed hands departs at the same time for the
same place.

**Clearing** (`clearLeaveDay`) deletes the row and clears the
`DRIVER_OFF_NEEDS_REVIEW` flag it caused — nothing else. Moved trips are **not**
moved back: they belong to whoever holds them now, and unwinding could
double-book that person.

**Every other assignment path** excludes an off driver by
`unavailabilities: { none: { date } }` — `batch-core`, `matching-actions`,
`placement-reco-data`, `duty-roster`. `tjw-request-actions` cannot use a per-day
filter (a ตจว spans days), so it converts each off-day into a whole-day
**synthetic commitment** the solver already knows how to respect.

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
| `lib/booking/audit.ts` | `logTransition` (per-booking) + `logEvent` (leave marked, เวร swapped, car re-paired — `entityType`/`entityId`, no booking) |
| `lib/booking/leave-core.ts` | §9b — one day of leave and every consequence: เวร re-pick, seat-aware hand-off, in-flight flagging |
| `lib/booking/availability-actions.ts` | Single-day + date-range leave server actions; emails only genuinely stranded trips |
| `lib/booking/day-window.ts` | `daySpan` / `daysSpanned` — project a (multi-day) trip onto a viewed day / its day cells |
| `lib/booking/overtime-reco.ts` | Advisory OT placement |
| `lib/booking/placement-reco.ts` | `recommendPlacement` — leftover/overflow suggestion, gated by `canChain` (pure) |
| `lib/booking/placement-reco-data.ts` | Server builder for the recommendation |
| `lib/booking/schedule-actions.ts` | Drag-drop reassign (`reassignVehicleAction` / `reassignSecondaryAction`) + `unassignBookingAction` (back to queue); blocks overlap on every car AND on the assigned driver's other-car commitments; per-leg co-driver re-validation |
| `lib/booking/driver-rounds.ts` | `buildDriverRounds` — pure day → per-driver rounds view-model (overnight phases) |
| `lib/booking/duty-roster.ts` | `ensureOnCallRosterThrough` — self-extending เวร rotation |
| `components/driver/driver-rounds-board.tsx` | Rounds board + job-type legend (both admin and kiosk) |
| `components/admin/round-reassign.tsx` | Per-round move / unassign control (admin only) |
| `components/forms/assign-reco-button.tsx` | One-click assign-to-recommendation |

See also: `docs/superpowers/specs/2026-06-15-duty-car-overlap-rule-design.md`,
`docs/superpowers/specs/2026-06-15-job-type-aware-chaining-design.md`.
