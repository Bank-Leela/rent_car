# DB-level no-double-book constraint — design

**Date:** 2026-07-01
**Status:** approved (brainstorm), pending implementation plan
**Approach:** B — occupancy table + trigger + GiST `EXCLUDE` (complete, no-wait-correct)

## Context

The core invariant of this system is **no car may ever be double-booked — not
even the duty car** (`docs/scheduling-algorithm.md` §5). Today it is enforced
**only in application code**, in three places: the matcher/solver picks, the
drag-drop `reassignVehicleAction`, and the board's conflict ring. A bug in any of
those paths could silently double-book a car. This adds a **database-level
backstop** so overlap is physically impossible regardless of app-code bugs.

**The wrinkle** (§4, no-wait split): when `waitAtDestination = false`, a trip
occupies **two** intervals — `[startAt, dropOffDone]` and `[pickupReturnTime,
endAt]` — and its middle is **free and intentionally reusable**. A naive `EXCLUDE`
on `tstzrange(startAt, endAt)` would wrongly reject a legal booking in that freed
gap. The constraint must be **per-leg**.

**Occupying statuses:** `APPROVED | ASSIGNED | COMPLETED` (the `COMMITTED_STATUSES`
set). A booking only occupies a car when `vehicleId IS NOT NULL` and status is in
that set.

## Environment facts (verified 2026-07-01)

- Postgres **16.14**; `btree_gist` **available but not installed** (needs
  `CREATE EXTENSION` — works on the local Homebrew role; **may need a Chula DBA on
  prod**).
- **0 existing overlaps** among occupying statuses → the constraint applies to
  current data without cleanup.
- 1 no-wait split booking currently in the DB.
- `pickupReturnTime` is stored as a `"HH:mm"` **String**, not a timestamp. No-wait
  trips are same-calendar-day, so leg-2 start = `date(startAt) + pickupReturnTime::interval`.

## Goals

- A car cannot hold two overlapping occupying intervals — enforced by the DB,
  correct for no-wait legs (freed middle stays reusable).
- The backstop is **app-independent**: derived by a trigger from `Booking`, so it
  catches a double-book even if the writing code forgot to check.
- App mutations that hit the backstop fail **gracefully** (friendly `vehicleBusy`,
  not a 500).

## Non-goals

- Enforcing the **2h chaining gap** at the DB — that's a soft, admin-overridable
  rule (§5); only literal overlap is hard.
- Modeling the duty-car reservation or fairness at the DB — app concerns.
- Changing any existing scheduling logic or the app's pre-checks — they stay; the
  DB is added underneath them.

## Design

### 1. `VehicleOccupancy` table (Prisma-modeled)

```prisma
model VehicleOccupancy {
  id        String   @id @default(cuid())
  bookingId String
  booking   Booking  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  vehicleId String
  vehicle   Vehicle  @relation(fields: [vehicleId], references: [id])
  startAt   DateTime
  endAt     DateTime

  @@index([vehicleId])
  @@index([bookingId])
}
```

One row per occupied interval (waiting → 1, no-wait → 2). Back-relations added to
`Booking` and `Vehicle`.

### 2. Raw SQL appended to the migration

Prisma does not model extensions, GiST `EXCLUDE`, or triggers — they are appended
to the generated `migration.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Derive a booking's occupancy rows. Mirrors lib/booking/trip-legs.ts.
CREATE OR REPLACE FUNCTION sync_vehicle_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b RECORD;
BEGIN
  b := COALESCE(NEW, OLD);
  DELETE FROM "VehicleOccupancy" WHERE "bookingId" = b.id;
  IF TG_OP <> 'DELETE'
     AND NEW."vehicleId" IS NOT NULL
     AND NEW.status IN ('APPROVED','ASSIGNED','COMPLETED') THEN
    IF NEW."waitAtDestination" = false
       AND NEW."dropOffDone" IS NOT NULL
       AND NEW."pickupReturnTime" IS NOT NULL THEN
      INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
        VALUES (gen_random_uuid()::text, NEW.id, NEW."vehicleId", NEW."startAt", NEW."dropOffDone");
      INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
        VALUES (gen_random_uuid()::text, NEW.id, NEW."vehicleId",
                date_trunc('day', NEW."startAt") + NEW."pickupReturnTime"::interval, NEW."endAt");
    ELSE
      INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
        VALUES (gen_random_uuid()::text, NEW.id, NEW."vehicleId", NEW."startAt", NEW."endAt");
    END IF;
  END IF;
  RETURN NULL;
END; $$;

CREATE TRIGGER booking_occupancy_sync
  AFTER INSERT OR UPDATE OR DELETE ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION sync_vehicle_occupancy();

-- Backfill existing occupying bookings (trigger only fires on future writes).
-- Waiting / single-interval:
INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
SELECT gen_random_uuid()::text, id, "vehicleId", "startAt", "endAt"
FROM "Booking"
WHERE "vehicleId" IS NOT NULL AND status IN ('APPROVED','ASSIGNED','COMPLETED')
  AND NOT ("waitAtDestination" = false AND "dropOffDone" IS NOT NULL AND "pickupReturnTime" IS NOT NULL);
-- No-wait leg 1 + leg 2:
INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
SELECT gen_random_uuid()::text, id, "vehicleId", "startAt", "dropOffDone"
FROM "Booking"
WHERE "vehicleId" IS NOT NULL AND status IN ('APPROVED','ASSIGNED','COMPLETED')
  AND "waitAtDestination" = false AND "dropOffDone" IS NOT NULL AND "pickupReturnTime" IS NOT NULL;
INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
SELECT gen_random_uuid()::text, id, "vehicleId",
       date_trunc('day', "startAt") + "pickupReturnTime"::interval, "endAt"
FROM "Booking"
WHERE "vehicleId" IS NOT NULL AND status IN ('APPROVED','ASSIGNED','COMPLETED')
  AND "waitAtDestination" = false AND "dropOffDone" IS NOT NULL AND "pickupReturnTime" IS NOT NULL;

-- The backstop. Added AFTER backfill so clean existing data doesn't reject it.
ALTER TABLE "VehicleOccupancy"
  ADD CONSTRAINT vehicle_occupancy_no_overlap
  EXCLUDE USING gist ("vehicleId" WITH =, tstzrange("startAt","endAt",'[)') WITH &&);
```

Order inside the migration: create table (Prisma) → extension → function → trigger
→ backfill → `EXCLUDE`.

### 3. App backstop handling

A booking write that would double-book makes the trigger insert an overlapping
occupancy row → the `EXCLUDE` raises Postgres error **`23P01`
(exclusion_violation)** → the whole transaction rolls back. The mutation actions
that place a car must translate that into the existing friendly result rather than
a 500:

- `reassignVehicleAction` (`lib/booking/schedule-actions.ts`) — wrap the write;
  on `23P01` return `{ ok: false, error: "vehicleBusy" }` (already exists).
- `runBatchAction`, `assignTjwByRequestOrder` — on `23P01`, skip that placement /
  surface it as an overflow rather than crashing the batch.

A small helper `isExclusionViolation(err)` centralizes the error-code check.

### 4. Testing (DB integration, `--no-file-parallelism`)

`lib/booking/vehicle-occupancy.test.ts`:
- Two overlapping waiting trips on one car → the second write throws `23P01`.
- A trip placed inside a no-wait trip's **freed middle** on the same car → allowed.
- A trip overlapping a no-wait **leg** → blocked.
- Trigger sync: assign creates rows; unassign/cancel/deny removes them; complete
  keeps them; editing times moves them.
- Parity check: the trigger's leg intervals equal `tripLegs()` for the same
  booking (guards against SQL/TS drift).

## Rollout & risk

- One Prisma migration (`migrate dev`), high-risk tier (schema + trigger + raw
  SQL). Reversible via a down migration (drop constraint/trigger/function/table).
- **Prod:** `CREATE EXTENSION btree_gist` may require a Chula DBA; flag in the
  release notes. If the extension can't be installed, the migration can't add the
  `EXCLUDE` (fall back to Approach A or app-only).
- Trigger duplicates `trip-legs.ts` math — the parity test is the guard.
- Verify after: `npm test` + the `simulate-cr07` scenarios (rule-check counters
  stay 0) since this sits under the scheduling writes.
