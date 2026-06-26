# Spec: "Car = Driver" model

**Date:** 2026-06-15
**Status:** Approved design — pending implementation plan
**Scope:** Full model rewrite. Replaces the shared driver-pool model with a 1:1
car↔driver model across schema, matcher, schedule board, and a new admin screen.

---

## 1. Summary

Today the system treats **vehicles** and **drivers** as two independent pools.
The matcher runs Algorithm 1 (pick a free vehicle slot) and Algorithm 2 (pick the
fairest free driver) separately, then staples them onto a booking. This produces
states the operator finds unintuitive — e.g. a car assigned with "no driver".

The real operation is **1 car = 1 fixed driver**: each car has a dedicated driver,
and "the car represents the driver." This spec reworks the system so the **driver
follows the car**. Assignment chooses a car; the driver is implied. The only
exception is a long-haul TJW (>400 km), which adds a **co-driver** (relief) riding
in the same car.

## 2. Goals

- Each active vehicle has exactly one assigned driver (1:1).
- Assigning a booking means assigning a **car**; the driver is derived.
- The schedule board is car-centric: each row shows "‹label› · ‹driver›", and a
  drop on a car always lands with that car's driver — the "no driver" concept is
  removed.
- The wern/duty highlight is always resolvable (= the on-call driver's car).
- Operators can edit car↔driver pairs in-app.

## 3. Non-goals

- No change to requester-facing booking flow, approvals, PDF, LINE, reports.
- No change to slot/time-bucket capacity math beyond what the driver-follows-car
  change forces.
- `isDutyVehicle` is **not** dropped from the schema (kept to avoid a destructive
  migration); it is only retired from logic.

## 4. Decisions (locked)

| # | Question | Decision |
|---|----------|----------|
| 1 | TJW >400 km needs 2 drivers, but 1 car = 1 driver | **Co-driver rides along** — one car, a 2nd driver as relief (`secondaryDriver`). 1:1 holds for every other trip. |
| 2 | Duty/wern rotation | Rotates among **drivers** (`OnCallShift` unchanged); the duty **car** = the on-call driver's assigned car. `isDutyVehicle` retired from logic. |
| 3 | Fairness ledger | **Kept**, keyed to the car-driver unit (the existing per-driver earnings ledger still applies, since car → driver). |
| 4 | 2-job/day cap + 2h chain rule | **Kept**, enforced on the car-driver unit. |
| 5 | Matcher | Picks a **car** by slot availability + fairness; driver follows. Co-driver added only for >400 km TJW. |
| 6 | Pairing data | **Auto-pair now + editable**: auto-assign stable pairs, plus an `/admin/fleet` screen to edit. |
| 7 | Existing bookings | One-off backfill: re-point current/future bookings' `primaryDriverId` to their car's assigned driver. |

## 5. Schema

`prisma/schema.prisma` — **HIGH RISK** (requires `prisma migrate dev` + per-turn auth).

```prisma
model Vehicle {
  // ...existing fields...
  assignedDriverId String?  @unique          // 1:1 — a driver owns at most one car
  assignedDriver   Driver?  @relation("VehicleDriver", fields: [assignedDriverId], references: [id])
  isDutyVehicle    Boolean  @default(false)  // DEPRECATED: retired from logic, kept for migration safety
}

model Driver {
  // ...existing fields...
  assignedVehicle  Vehicle? @relation("VehicleDriver")
}
```

- `assignedDriverId` is **nullable** — an unpaired car is a valid (degenerate)
  state, surfaced in the UI as "no driver set for this car" (a configuration gap,
  not a per-trip state).
- `@unique` enforces that a driver is paired to at most one car.
- Migration is **additive** (new nullable column + relation) — no data loss.

## 6. Pairing

- **Backfill script** `scripts/pair-cars-drivers.ts`: pair each active vehicle with
  a distinct active driver in a stable order; write `assignedDriverId`. Idempotent.
- **Admin screen** `/admin/fleet`:
  - Lists active cars; each row has a driver `<select>` (drivers not already
    paired elsewhere, plus the current one).
  - `setVehicleDriverAction(vehicleId, driverId | null)` — validates uniqueness,
    updates `assignedDriverId`. ADMIN-only.

## 7. Matcher rewrite

Affected: `lib/booking/batch-solver.ts`, `matching.ts`, `matching-actions.ts`,
`batch-actions.ts`, `driver-capacity.ts`, `rotations.ts`, `earnings.ts`,
`slot-allocation.ts`.

- **Unit of assignment = car.** Algorithm 2 (independent driver pick) is removed.
  The matcher selects a car by:
  1. slot/time-bucket availability (existing Algorithm 1), AND
  2. the car-driver unit passing `canTakeTrip` (no overlap, ≤2 jobs/day, 2h chain), AND
  3. fairness order — rank eligible cars by their driver's earnings ledger
     (least-loaded first), same `tripEffort` weighting as today.
- **Duty exclusion:** the on-call driver's car is excluded from regular (NORMAL/OT)
  jobs, as the duty driver is today.
- **Co-driver (>400 km TJW only):** after the primary car+driver is chosen, pick a
  2nd eligible free driver as `secondaryDriver` (relief). That co-driver's own car
  is treated as unavailable for the trip's span (its driver is occupied riding
  along). No second vehicle is dispatched.
- **WERN:** the duty car-driver unit takes WERN jobs (was: duty driver).
- **Fairness/rotation ledgers** (`lastAssignedAt`, `lastTjwAt`, `lastOtAt`,
  `lastDutyAt`) remain on `Driver` and are stamped exactly as today — the driver
  is now reached via the car, but the ledger is unchanged.

## 8. Schedule board

`components/admin/scheduler-board.tsx`, `app/(admin)/admin/schedule/page.tsx`,
`lib/booking/schedule-actions.ts`.

- Each car row label: **"‹A–F› · ‹driver name›"** (driver from `assignedDriver`).
- `reassignVehicleAction`: drop assigns the car **+ its assigned driver**, always.
  Removes `pickFreeDriver`, the `driverless` return, the amber `dropNote`, and the
  red "no driver" flag.
- Car-busy conflict check stays (now also means driver-busy).
- Co-driver: a >400 km TJW block shows the primary driver + a "+co-driver" marker.
- Wern badge = the on-call driver's car (always resolvable now).
- Degenerate case: dropping on a car with **no** `assignedDriver` → block with
  "set a driver for this car" pointing at `/admin/fleet`.

## 9. Existing data migration

- `scripts/backfill-booking-drivers.ts`: for APPROVED/ASSIGNED bookings from today
  forward, set `primaryDriverId` = the booking's vehicle's `assignedDriver`
  (where a vehicle is set). Leave historical/completed bookings untouched.
- Idempotent; logs counts.

## 10. i18n

- New keys: `fleet.title`, `fleet.car`, `fleet.driver`, `fleet.save`,
  `fleet.unpaired`, scheduler `noAssignedDriver` (degenerate-car message).
- Remove/retire scheduler `dropDriverless`, `dropFailed`, `noDriver` usage on the
  board (keep keys until cleanup).

## 11. Testing & verification

- `npx tsc --noEmit`, `npm run lint`, `npx next build`.
- `npx vitest run --no-file-parallelism lib/booking/` — rewrite/extend:
  - `driver-capacity.test.ts` → car-unit eligibility.
  - matcher/simulation tests → driver-follows-car; co-driver only on >400 km TJW;
    duty car exclusion; fairness ordering by car's driver.
- `prisma migrate diff` dry-run + `prisma generate` after the schema change.
- Behavioral: seed a day, exercise drop (always lands with driver), wern badge,
  long-haul co-driver, duty exclusion.

## 12. Rollout phases (for the implementation plan)

1. Schema + migration + `prisma generate`.
2. Pairing backfill script + `/admin/fleet` screen + action.
3. Matcher rewrite (driver-capacity → car-unit, batch-solver, matching, fairness,
   rotations) + tests green.
4. Schedule board + `reassignVehicleAction` rewrite.
5. Booking-driver backfill script.
6. Full verification (tsc/lint/build/vitest) + behavioral seed checks.

## 13. Risks

- **Schema migration** on `schema.prisma` — high-risk; additive but irreversible
  in prod. Dry-run first.
- **Matcher rewrite** touches the most-tested code in the repo; regressions in
  TJW/OT/WERN/fairness are the main danger → tests rewritten alongside.
- **Co-driver edge cases** (their idle car, overlapping co-driver demand) — keep
  conservative: a co-driver must be a fully-free driver.
- **Unpaired cars** — must degrade gracefully, not crash assignment.

## 14. Open questions (resolve during planning)

- Should an **unpaired** car be hidden from the matcher entirely, or surfaced as a
  blocked slot? (Lean: excluded from auto-match, shown on the board as needs-setup.)
- Co-driver fairness: does relief duty count toward the co-driver's ledger?
  (Lean: yes, partial — stamp `lastAssignedAt`.)
