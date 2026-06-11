# Design: Overtime placement recommendation (P'Top queue highlight)

Date: 2026-06-11
Status: Approved (brainstorming) — pending implementation
Scope: admin booking queue + a pure recommendation helper. No change to the
submit gate, the batch solver, or the waitlist mechanism.

---

## Problem

The day-capacity gate (`lib/booking/slot-capacity.ts`,
`dayCapacity = nonDutyVehicles * 2 + dutyVehicles`) counts **normal-day**
(08:00–16:00) slots — one morning + one afternoon per non-duty car, plus one
duty spare. When the day's count reaches that number, the next request is
`WAITLIST`ed for P'Top (`actions.ts` → `submitStatus`).

But the gate is **time-blind**: it compares a total count, not the new
booking's actual hours. An **OT outside the normal window** (e.g. an evening
job at 20:00, or an early job before 08:00) is *overtime — extra hours on top
of the normal day*. A driver booked 08:00–16:00 is free again at 20:00, so that
OT genuinely fits — yet the gate waitlists it because the day already has ≥ cap
bookings. P'Top then sees a waitlisted booking with **no signal that it
actually fits**.

## Goal

For each over-capacity (`WAITLIST`) booking in P'Top's queue, if the booking's
real time is outside the normal window **and** a non-duty driver + a vehicle are
genuinely free at that time, **highlight it** and **name the driver and car**,
so P'Top can place it directly. Advisory only — the gate and waitlist are
unchanged.

## Non-goals (v1)

- No time-shifting (the requested time is fixed).
- No auto-assign / apply button — **highlight only** (a one-click
  assign-as-overtime action is a possible v2).
- No change to the submit gate, the batch solver, the 2-job/day cap, or the
  waitlist.
- The **duty (เวร) driver is excluded** from the recommendation — they have
  already done their duty day.

## Architecture

One pure helper + a server-side call in the queue page.

- **`lib/booking/overtime-reco.ts`** — new, pure, no I/O:
  `recommendOvertimePlacement(input): OvertimeReco`.
- **`app/(admin)/admin/page.tsx`** — P'Top's queue already loads
  `PENDING_APPROVAL` + `WAITLIST`. For each `WAITLIST` booking, gather the day's
  data and call the helper; pass the result to the row for rendering.

## The helper

```ts
type OvertimeReco =
  | { kind: "overtime-fit"; driverId: string; vehicleId: string }
  | { kind: "no-fit" }            // out-of-window, but nothing free
  | { kind: "not-applicable" };   // within the normal window — not overtime

interface OvertimeRecoInput {
  booking: { startAt: Date; endAt: Date };
  dutyDriverId: string | null;                       // excluded from candidates
  drivers: Array<{
    driverId: string;
    earningsScore: number;                            // duration-weighted ledger
    lastAssignedAt: Date | null;
    trips: Array<{ startAt: Date; endAt: Date }>;     // the driver's bookings that day
  }>;
  vehicles: Array<{ vehicleId: string; isDutyVehicle: boolean }>;
  vehicleTrips: Array<{ vehicleId: string; startAt: Date; endAt: Date }>; // day occupancy
  day: Date;
}
```

Logic:

1. **Out-of-window gate.** Compute whether the booking is overtime by time —
   `startAt` hour < 8 **or** `endAt` after 16:00 (mirrors the OT-by-time rule in
   `classifyJobType`). If it is fully inside 08:00–16:00 → `not-applicable`.

2. **Free driver.** A candidate is any **active, non-duty** driver
   (`driverId !== dutyDriverId`) with **no trip overlapping** the booking's
   `[startAt, endAt]` (`a.startAt < b.endAt && b.startAt < a.endAt`).
   Deliberately **ignores the 2-job/day cap** — overtime is extra, so a driver
   who already worked a full normal day is eligible. Among candidates, pick the
   **fairest**: lowest `earningsScore`, then oldest `lastAssignedAt`, then
   `driverId` (same comparator the matcher uses, so overtime is shared evenly).

3. **Free vehicle.** Build the day's slot grid (`buildSlotTable` +
   `vehicleOccupancyForDay`) and find a vehicle free in **every bucket the
   booking overlaps** (`bucketsForTrip`). Before-08 / after-16 buckets are free
   on every car, including the duty vehicle, so the car pool is the full active
   fleet minus whatever overlaps that time.

4. If a driver **and** a vehicle are found → `overtime-fit` with both ids; else
   → `no-fit`. The UI resolves ids to names.

The helper reuses existing primitives: `bucketsForTrip`, `buildSlotTable`,
`vehicleOccupancyForDay`, and the earnings/`lastAssignedAt` fairness comparator.

## UI

In P'Top's queue, a `WAITLIST` row whose reco is `overtime-fit` renders a
highlight badge (bilingual, Thai primary), e.g.:

> ⚡ จัดได้แบบ OT/ล่วงเวลา — คนขับ **{name}** + รถ **{registration}** ว่างช่วงนี้

`no-fit` and `not-applicable` render nothing extra (the row stays a normal
waitlist entry). Read-only — P'Top still approves/denies via the existing flow.

## Data flow

`admin/page.tsx` (server component) for the queue:
- loads active drivers (+ their same-day trips), active vehicles (+ same-day
  vehicle occupancy), the day's `OnCallShift` duty driver, and the earnings
  ledger — for each distinct booking day present in the `WAITLIST` set;
- calls `recommendOvertimePlacement` per `WAITLIST` booking;
- passes `{ booking, reco, driverName?, vehicleReg? }` to the row component.

(If multiple waitlist days are common, batch the per-day loads by day to avoid
N queries; otherwise a per-booking load is acceptable for v1's small queue.)

## Testing (TDD)

Unit-test the pure helper:
- evening OT (20:00–21:00), all drivers free in the evening → `overtime-fit`
  naming the fairest non-duty driver + a free car;
- early OT (05:00–07:00) → `overtime-fit`;
- a within-window booking (10:00–12:00) → `not-applicable`;
- out-of-window but every non-duty driver has an overlapping evening trip →
  `no-fit`;
- out-of-window, a driver free but no vehicle free in the bucket → `no-fit`;
- the duty driver is never chosen even when free;
- the 2-job/day cap does **not** block (a driver with a full 08:00–16:00 day is
  still recommended for a 20:00 OT).

## Risks / notes

- The recommendation **bypasses the 2-job cap** on purpose (overtime). It is
  advisory; P'Top authorizes the actual overtime by approving the booking. No
  rule is changed in code.
- Fairness: picking the lowest-`earningsScore` free driver spreads overtime, but
  overtime credited via the same `tripEffort` ledger means a driver who does an
  evening OT moves down the queue next time — consistent with the rest of the
  system.
- v2 candidates (out of scope): one-click apply (assign-as-overtime action,
  bypassing the cap with an audit row); cover same-area overnight OT spanning
  into the next day.
