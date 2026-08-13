# จัด on approval — design

**Status:** approved in conversation 2026-08-06, not yet implemented.
**Scope:** sub-project **D** of five (see [Programme context](#programme-context)).

---

## The problem

Approving a booking assigns nothing. Only two things ever trigger assignment:

1. P'Top pressing จัดรอบ on `/admin/batch`
2. the nightly cron — which assigns **tomorrow only**

So a request approved on 6 Aug for the 20th sits in `รอจัดรถ` until the night of
the 19th. Measured at the time of writing: **5 APPROVED-unassigned, 0 carrying an
`overflowReason`** — the solver had never looked at them.

From P'Top's seat, approving does nothing. That is the whole complaint.

## The rule being implemented

> If the day's cases are approved and time allows, the case is automatically
> assigned a car. The 13th case onward — or anything that does not fit — is where
> P'Top places it manually.

## Design

### 1. One hook, no new solver

After a successful approval commits, call the existing plain function:

```ts
runBatchForDay(dayOf(booking.startAt), adminId)
```

It already selects `status: "APPROVED", primaryDriverId: null`, so it is
**idempotent** — it never disturbs an existing assignment, and it seeds the
solver with trips already on cars that day. It already respects leave, เวร,
`canChain`, the 2h gap and fairness, and already writes `overflowReason` for
anything it cannot place.

Nothing about the allocation rules changes. This is a scheduling change, not an
algorithm change.

### 2. No new capacity counter

"12" is not implemented as a check. Six cars × (morning + afternoon) is already
the natural ceiling; the 13th booking finds no legal car+driver and receives an
`overflowReason`.

`dayCapacity()` in `slot-capacity.ts` already computes a similar-looking number
for a **different** purpose — submit-time WAITLIST gating — and its own comment
says it is "independent of the later admin-side batch matching". Introducing a
second capacity check would create two sources of truth that can disagree with
the solver. Do not add one.

### 3. Approval must never fail because assignment did

The `runBatchForDay` call is wrapped in try/catch, exactly as the PDF generation
step already is. If it throws, the booking stays APPROVED and appears in the
overflow bar. Approving is the user's act; assigning is a consequence of it, and
a consequence must not be able to undo its cause.

### 4. Deliberately still manual

These four never auto-assign, today or after this change:

| Kind | Why |
|------|-----|
| ตจว–ค้างคืน (TJW) | allocated by request order across **all** days, not per-day, via `assignTjwByRequestOrder` |
| จองเร่งด่วน (`isEmergency`) | stays manual on purpose so an admin looks at it |
| รถบัสเช่า (`BUS_OUTSOURCED`) | no internal car to assign |
| SMUS | external charter — no internal car to assign (see the note below) |

> **Correction (2026-08-13).** This spec described SMUS as "retired". It is not:
> SMUS was retired in `9ccc55a` and restored, and is live today. The row above has
> been corrected because it was being read as current fact. The reason SMUS is
> excluded from assignment is unchanged — an external charter has no internal car to
> assign — only the stated reason was wrong. `docs/scheduling-algorithm.md` §2 is the
> authority.

### 5. The nightly sweep widens

Currently the cron assigns tomorrow only. It changes to sweep **every day that
has APPROVED-unassigned bookings**, so a trip that becomes placeable later — a
driver returned from leave, a cancellation freed a car — is picked up without
anyone pressing anything.

### 6. UI

**Remove** the `รอจัดรถ` section from `/admin`.

**Add** an overflow bar above the board on `/admin/schedule`.

Its query is **not** `overflowReason != null`. It is *everything for that day
still needing a car*:

```
status: APPROVED, primaryDriverId: null, startAt within the viewed day
```

This matters: TJW, urgent and hired-bus bookings are never selected by the batch,
so they never receive an `overflowReason`. Keying the bar on that column would
make them invisible the moment `รอจัดรถ` is removed. Where a reason exists, show
it; where it does not, show the kind (ตจว / จองเร่งด่วน / รถบัสเช่า).

Each row carries the existing one-click `AssignRecoButton`. A plain list for now;
it becomes the drag source when sub-project **C** restores the timeline board.

## Known consequence — cross-day visibility

`รอจัดรถ` on `/admin` currently lists approved-unassigned bookings **across all
days** (the screenshot that prompted this showed 6, 10 and 20 Aug together). The
new bar is **per-day**: a TJW for next month is invisible until P'Top navigates
to that day.

After this change the backlog should be near-empty — only the four manual kinds
and genuine overflow remain — so the risk is small but real. Options, to decide
before implementation:

- **(a)** accept it; P'Top finds these via the calendar
- **(b)** keep a small "ยังไม่ได้จัดรถ (n)" count on `/admin` linking to the
  earliest affected day
- **(c)** the bar shows the viewed day plus a count of other affected days

Recommendation: **(b)** — one number, no list, restores the "is anything
outstanding?" answer that removing `รอจัดรถ` takes away.

## Testing

| Case | Expected |
|------|----------|
| Approve a fitting booking | assigned immediately; car + driver set |
| Approve when the day is full | stays APPROVED, `overflowReason` set, appears in the bar |
| Approve the same booking twice | no double-assign, no disturbance to others |
| Solver throws | approval still succeeds; booking appears in the bar |
| Approve a TJW / urgent / bus | untouched by auto-assign; appears in the bar |
| Approve for a day where a driver is on leave | that driver is not chosen |
| Nightly sweep after leave ends | previously unplaceable trip gets assigned |

Regression: `npm test`, plus all seven `simulate-cr07` scenarios (the approval
path now reaches the solver, so scheduling invariants must be re-proved).

## Programme context

This is one of five pieces identified on 2026-08-06. Recorded so the decisions
are not lost:

| | Piece | Decisions already taken |
|---|---|---|
| **A** | Leave: date ranges + forward visibility | admin-only (drivers stay passive); no leave types, quotas or balances; marking leave **auto re-rosters เวร** for affected days |
| **B** | Leave hand-off | a driver's jobs that day go to the **เวร driver**, not back to รอจัดรถ; admin can override |
| **C** | Timeline board returns | restore `scheduler-board*` (deleted in `10c730f`) + `adhoc-actions.ts` (deleted in `bed8175`); `@dnd-kit/core` is still installed; add the overflow bar as a drag source; P'Top can edit **เวร job times** by dragging |
| **D** | **จัด on approval** | this document |
| **E** | Passenger contact info shown on the board for the driver | — |

Order: **D → C → A + B + E.** C absorbs B's override and D's drag source.
