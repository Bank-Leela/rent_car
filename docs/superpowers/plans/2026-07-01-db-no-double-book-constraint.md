# DB No-Double-Book Constraint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it physically impossible for a vehicle to be double-booked, at the database level, correct for no-wait split-leg trips.

**Architecture:** A `VehicleOccupancy` table holds one row per occupied interval (1 for a waiting trip, 2 for a no-wait trip's legs). A `BEFORE`-agnostic `AFTER` trigger on `Booking` derives those rows automatically. A GiST `EXCLUDE` constraint on `VehicleOccupancy` forbids overlapping intervals on the same car. App mutations translate the resulting Postgres `23P01` into the existing friendly `vehicleBusy` result.

**Tech Stack:** Prisma 5 + PostgreSQL 16 (`btree_gist`, GiST `EXCLUDE`, PL/pgSQL trigger), Next.js 16 server actions, Vitest (DB-integration).

## Global Constraints

- Node 20; package manager **npm** (not pnpm).
- DB-integration vitest MUST run with `--no-file-parallelism` (shared dev DB).
- Migrations via `npx prisma migrate dev` (NOT `db push` — it skips raw SQL).
- Occupying statuses = `APPROVED | ASSIGNED | COMPLETED`; a booking occupies a car only when `vehicleId IS NOT NULL` and status is in that set.
- Ranges are **half-open `[)`** — touching intervals (endAt == next startAt) do NOT overlap.
- No-wait leg-2 start = `date_trunc('day', startAt) + pickupReturnTime::interval` (no-wait is same calendar day; `pickupReturnTime` is a `"HH:mm"` string).
- Leg math MUST match `lib/booking/trip-legs.ts` (`tripLegs`); a parity test guards the SQL/TS drift.
- Design source of truth: `docs/superpowers/specs/2026-07-01-db-no-double-book-constraint-design.md`.

---

### Task 1: `VehicleOccupancy` model + the migration (extension, trigger, backfill, EXCLUDE)

**Files:**
- Modify: `prisma/schema.prisma` (add `model VehicleOccupancy`; add back-relations to `Booking` and `Vehicle`)
- Create: `prisma/migrations/<timestamp>_vehicle_occupancy_no_double_book/migration.sql` (Prisma-generated, then hand-augmented)
- Test: `lib/booking/vehicle-occupancy.test.ts`

**Interfaces:**
- Produces: table `VehicleOccupancy(id, bookingId, vehicleId, startAt, endAt)`, trigger `booking_occupancy_sync`, constraint `vehicle_occupancy_no_overlap`. Prisma model `VehicleOccupancy` readable via `prisma.vehicleOccupancy`.

- [ ] **Step 1: Write the failing test** — `lib/booking/vehicle-occupancy.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, startOfDay } from "date-fns";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })) }));

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const MARKER = "OCCUPANCY-TEST";
const DAY = startOfDay(addDays(new Date(), 200)); // quiet far-future day
const at = (h: number, m = 0) => { const d = new Date(DAY); d.setHours(h, m, 0, 0); return d; };
const createdIds: string[] = [];
let seq = 0;
const jn = () => `VB-OCC-${Date.now()}-${seq++}`;
let carA: string;

async function mk(over: Partial<Prisma.BookingUncheckedCreateInput> & { startAt: Date; endAt: Date }) {
  const b = await prisma.booking.create({
    data: {
      jobNumber: jn(), requesterId: "seed-user-requester", departmentId: "seed-dept-medicine",
      purpose: MARKER, destination: "T", province: "กรุงเทพมหานคร", passengerCount: 1,
      jobType: "NORMAL", timeBucket: "MORNING_08_12", status: "ASSIGNED", ...over,
    },
  });
  createdIds.push(b.id);
  return b;
}

beforeAll(async () => {
  const v = await prisma.vehicle.findFirst({ where: { isActive: true, assignedDriverId: { not: null } }, select: { id: true } });
  if (!v) throw new Error("Need an active paired vehicle — run the seed.");
  carA = v.id;
});
afterAll(async () => {
  const extra = await prisma.booking.findMany({ where: { purpose: MARKER }, select: { id: true } });
  const ids = [...new Set([...createdIds, ...extra.map((r) => r.id)])];
  if (ids.length) {
    await prisma.vehicleOccupancy.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

describe("no-double-book EXCLUDE", () => {
  it("blocks a second overlapping waiting trip on the same car", async () => {
    await mk({ startAt: at(9), endAt: at(11), vehicleId: carA });
    await expect(
      mk({ startAt: at(10), endAt: at(12), vehicleId: carA }),
    ).rejects.toThrow(); // Postgres 23P01 exclusion_violation
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (no constraint yet)**

Run: `npx vitest run lib/booking/vehicle-occupancy.test.ts --no-file-parallelism`
Expected: FAIL — the second `mk()` resolves instead of rejecting (`prisma.vehicleOccupancy` may also error as "unknown" — that's still red).

- [ ] **Step 3: Add the Prisma model + back-relations** — `prisma/schema.prisma`

Add the model:
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
In `model Booking { ... }` add: `occupancies VehicleOccupancy[]`
In `model Vehicle { ... }` add: `occupancies VehicleOccupancy[]`

- [ ] **Step 4: Generate the migration WITHOUT applying**

Run: `npx prisma migrate dev --name vehicle_occupancy_no_double_book --create-only`
Expected: a new folder `prisma/migrations/<ts>_vehicle_occupancy_no_double_book/migration.sql` containing the `CREATE TABLE "VehicleOccupancy"` + FKs + indexes. NOT yet applied.

- [ ] **Step 5: Append the raw SQL to that `migration.sql`**

Append verbatim (from the spec) AFTER the generated `CREATE TABLE`/index/FK statements:
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION sync_vehicle_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "VehicleOccupancy" WHERE "bookingId" = COALESCE(NEW.id, OLD.id);
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

INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
SELECT gen_random_uuid()::text, id, "vehicleId", "startAt", "endAt"
FROM "Booking"
WHERE "vehicleId" IS NOT NULL AND status IN ('APPROVED','ASSIGNED','COMPLETED')
  AND NOT ("waitAtDestination" = false AND "dropOffDone" IS NOT NULL AND "pickupReturnTime" IS NOT NULL);

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

ALTER TABLE "VehicleOccupancy"
  ADD CONSTRAINT vehicle_occupancy_no_overlap
  EXCLUDE USING gist ("vehicleId" WITH =, tstzrange("startAt","endAt",'[)') WITH &&);
```

- [ ] **Step 6: Apply the migration**

Run: `npx prisma migrate dev`
Expected: "The following migration(s) have been applied" + `prisma generate` runs. No error (0 existing overlaps → the `EXCLUDE` is accepted).

- [ ] **Step 7: Run the test — expect PASS**

Run: `npx vitest run lib/booking/vehicle-occupancy.test.ts --no-file-parallelism`
Expected: PASS (the second overlapping create rejects with `23P01`).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/booking/vehicle-occupancy.test.ts
git commit -m "feat(db): no-double-book — VehicleOccupancy + GiST EXCLUDE + sync trigger"
```

---

### Task 2: Occupancy correctness tests (no-wait legs + trigger sync + parity)

**Files:**
- Modify: `lib/booking/vehicle-occupancy.test.ts` (add describes)

**Interfaces:**
- Consumes: the `mk()` helper, `carA`, `prisma.vehicleOccupancy` from Task 1.

- [ ] **Step 1: Add the no-wait + sync + parity tests**

```ts
import { tripLegs } from "@/lib/booking/trip-legs";

describe("no-wait legs", () => {
  it("allows a trip inside a no-wait trip's freed middle, blocks one overlapping a leg", async () => {
    // No-wait A: out 09:00, drop-off done 10:00, returns 14:00, back 15:00 → free 10:00–14:00.
    await mk({
      startAt: at(9), endAt: at(15), vehicleId: carA,
      waitAtDestination: false, dropOffDone: at(10), pickupReturnTime: "14:00",
    });
    // B sits fully in the freed middle 11:00–13:00 → allowed.
    await expect(mk({ startAt: at(11), endAt: at(13), vehicleId: carA })).resolves.toBeTruthy();
    // C overlaps leg 1 (09:00–10:00) → blocked.
    await expect(mk({ startAt: at(9, 30), endAt: at(10, 30), vehicleId: carA })).rejects.toThrow();
  });
});

describe("trigger keeps occupancy in sync", () => {
  it("adds rows on assign, removes them on cancel/unassign, none for PENDING", async () => {
    const b = await mk({ startAt: at(16), endAt: at(17), vehicleId: carA });
    expect(await prisma.vehicleOccupancy.count({ where: { bookingId: b.id } })).toBe(1);
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", vehicleId: null } });
    expect(await prisma.vehicleOccupancy.count({ where: { bookingId: b.id } })).toBe(0);
  });
});

describe("SQL legs match trip-legs.ts", () => {
  it("stores exactly the intervals tripLegs() computes for a no-wait trip", async () => {
    const b = await mk({
      startAt: at(6), endAt: at(8), vehicleId: carA,
      waitAtDestination: false, dropOffDone: at(6, 30), pickupReturnTime: "07:30",
    });
    const rows = await prisma.vehicleOccupancy.findMany({ where: { bookingId: b.id }, orderBy: { startAt: "asc" } });
    const legs = tripLegs({ startAt: b.startAt, endAt: b.endAt, waitAtDestination: b.waitAtDestination, dropOffDone: b.dropOffDone, pickupReturnTime: b.pickupReturnTime });
    expect(rows.length).toBe(legs.length);
    rows.forEach((r, i) => {
      expect(r.startAt.getTime()).toBe(legs[i]!.start.getTime());
      expect(r.endAt.getTime()).toBe(legs[i]!.end.getTime());
    });
  });
});
```

> NOTE: confirm the exact `tripLegs` input shape + returned field names (`start`/`end` vs `startAt`/`endAt`) against `lib/booking/trip-legs.ts` and adjust the parity assertions to match before running.

- [ ] **Step 2: Run — expect PASS**

Run: `npx vitest run lib/booking/vehicle-occupancy.test.ts --no-file-parallelism`
Expected: PASS (all describes).

- [ ] **Step 3: Commit**

```bash
git add lib/booking/vehicle-occupancy.test.ts
git commit -m "test(db): no-wait legs, trigger sync, and trip-legs parity for occupancy"
```

---

### Task 3: App backstop — translate `23P01` to `vehicleBusy`

**Files:**
- Create: `lib/booking/db-errors.ts`
- Modify: `lib/booking/schedule-actions.ts` (`reassignVehicleAction` — wrap the final write)
- Modify: `lib/booking/batch-actions.ts`, `lib/booking/tjw-request-actions.ts` (guard each placement write)
- Test: `lib/booking/db-errors.test.ts`

**Interfaces:**
- Produces: `isExclusionViolation(err: unknown): boolean`.

- [ ] **Step 1: Write the failing test** — `lib/booking/db-errors.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { isExclusionViolation } from "@/lib/booking/db-errors";

describe("isExclusionViolation", () => {
  it("is true for a Postgres 23P01 exclusion violation", () => {
    const err = new Prisma.PrismaClientKnownRequestError("exclusion", { code: "P2010", clientVersion: "5", meta: { code: "23P01" } });
    expect(isExclusionViolation(err)).toBe(true);
  });
  it("is false for anything else", () => {
    expect(isExclusionViolation(new Error("nope"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `npx vitest run lib/booking/db-errors.test.ts --no-file-parallelism`
Expected: FAIL — cannot find `@/lib/booking/db-errors`.

- [ ] **Step 3: Implement the helper** — `lib/booking/db-errors.ts`

```ts
import { Prisma } from "@prisma/client";

// Postgres raises SQLSTATE 23P01 (exclusion_violation) when a write would break
// the no-double-book EXCLUDE. Prisma surfaces it as a raw-query error (P2010)
// or an unknown-request error; the underlying PG code lives in `meta.code` or
// the message. This recognises it so callers can return a friendly "vehicleBusy".
export function isExclusionViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const metaCode = (err.meta as { code?: string } | undefined)?.code;
    if (metaCode === "23P01") return true;
  }
  return err instanceof Error && /23P01|exclusion_violation|vehicle_occupancy_no_overlap/i.test(err.message);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run lib/booking/db-errors.test.ts --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Guard `reassignVehicleAction`** — `lib/booking/schedule-actions.ts`

The function pre-checks conflicts and returns `{ ok: false, error: "vehicleBusy", conflicts }` before writing. Wrap the FINAL booking write (the `prisma.$transaction`/`booking.update` that sets `vehicleId`) so the DB backstop degrades gracefully:
```ts
import { isExclusionViolation } from "@/lib/booking/db-errors";
// ...
try {
  // <existing final write: prisma.$transaction([...]) / booking.update({...})>
} catch (e) {
  if (isExclusionViolation(e)) return { ok: false, error: "vehicleBusy" };
  throw e;
}
```

- [ ] **Step 6: Guard the batch placement writes** — `lib/booking/batch-actions.ts` and `lib/booking/tjw-request-actions.ts`

Each loops over placements and writes a vehicle/driver assignment per booking. Wrap the per-booking write so a backstop hit skips that placement instead of aborting the batch:
```ts
import { isExclusionViolation } from "@/lib/booking/db-errors";
// inside the per-placement loop, around the write that sets vehicleId/status:
try {
  // <existing per-booking assignment write>
} catch (e) {
  if (isExclusionViolation(e)) { /* leave unassigned: push to overflow with reason "vehicleBusy" */ continue; }
  throw e;
}
```
> Match the surrounding loop's overflow-collection shape (e.g. push `{ bookingId, reason: "vehicleBusy" }`) — read the function first.

- [ ] **Step 7: Verify nothing regressed**

Run: `npm run typecheck && npx vitest run --no-file-parallelism`
Expected: typecheck clean; all tests pass.

- [ ] **Step 8: Scheduling sanity**

Run: `npx tsx scripts/simulate-cr07.ts --scenario=mixed`
Expected: rule-check counters (2h buffer violations, duty-driver-extra) stay **0**.

- [ ] **Step 9: Commit**

```bash
git add lib/booking/db-errors.ts lib/booking/db-errors.test.ts lib/booking/schedule-actions.ts lib/booking/batch-actions.ts lib/booking/tjw-request-actions.ts
git commit -m "feat(booking): translate no-double-book EXCLUDE hits to vehicleBusy"
```

---

## Self-Review

- **Spec coverage:** table (T1), extension/trigger/backfill/EXCLUDE (T1), no-wait per-leg correctness (T1 SQL + T2 tests), app `23P01` handling (T3), tests incl. parity (T2), sim sanity (T3 step 8). ✓
- **Placeholders:** the two `> NOTE` callouts flag real "read-the-file-first" points (tripLegs field names; loop overflow shape) rather than hiding work — acceptable, but the implementer MUST resolve them, not copy blindly.
- **Type consistency:** `isExclusionViolation` name used identically in T3 steps 3/5/6; `prisma.vehicleOccupancy` matches the model `VehicleOccupancy`; occupying-status list identical in trigger, backfill, and tests.

## Rollout notes

- High-risk tier (schema + migration + trigger). Reversible: a down migration drops the constraint, trigger, function, then the table.
- **Prod:** `CREATE EXTENSION btree_gist` may need a Chula DBA — call it out in the release/PR notes. If unavailable, the migration's `EXCLUDE` step can't run; fall back to Approach A (partial, app-role-installable) or app-only.
