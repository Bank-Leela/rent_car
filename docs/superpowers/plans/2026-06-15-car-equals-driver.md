# Car = Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each active car own exactly one driver (1:1), so assigning a booking means assigning a car and the driver follows — with a co-driver only for >400 km TJW.

**Architecture:** Add `Vehicle.assignedDriverId` (1:1). The batch solver keeps its rotation/fairness/eligibility primitives (a driver pick already *is* a car pick under 1:1); we bind each assignment's `vehicleId = driver's assignedVehicle` and delete the independent vehicle-slot allocation. The schedule board becomes car-centric (row = "label · driver"), and a drop always lands the car + its driver. A new `/admin/fleet` screen edits pairs.

**Tech Stack:** Next.js 16, React 19, Prisma 5 (PostgreSQL), next-intl, @dnd-kit, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-15-car-equals-driver-design.md`

**Verification baseline (run after every phase):**
`npx tsc --noEmit` · `npm run lint` · `npx vitest run --no-file-parallelism lib/booking/`

---

## File map

| File | Change |
|------|--------|
| `prisma/schema.prisma` | + `Vehicle.assignedDriverId` (`@unique`) + relations |
| `lib/booking/fleet.ts` | **new** — `pairCarsToDrivers`, `vehicleDriverMap` helpers |
| `lib/booking/fleet.test.ts` | **new** — unit tests for pairing helpers |
| `scripts/pair-cars-drivers.ts` | **new** — idempotent backfill of `assignedDriverId` |
| `lib/booking/fleet-actions.ts` | **new** — `setVehicleDriverAction` (ADMIN) |
| `app/(admin)/admin/fleet/page.tsx` | **new** — car↔driver editor |
| `components/admin/fleet-editor.tsx` | **new** — client form (per-car driver `<select>`) |
| `lib/booking/batch-actions.ts` | bind `vehicleId = driver's car`; drop independent vehicle allocation; mark co-driver's car busy |
| `lib/booking/matching-actions.ts` | single-booking path: vehicle = picked driver's car |
| `lib/booking/matching.ts` | vehicle selection → driver's car |
| `lib/booking/schedule-actions.ts` | `reassignVehicleAction` → assign car + its driver, always |
| `components/admin/scheduler-board.tsx` | row "label · driver"; remove driverless/no-driver; co-driver marker |
| `app/(admin)/admin/schedule/page.tsx` | pass each car's driver + duty car |
| `scripts/backfill-booking-drivers.ts` | **new** — re-point future bookings' drivers to car's driver |
| `messages/en.json`, `messages/th.json` | `fleet.*`, `scheduler.noAssignedDriver`, `scheduler.coDriver` |

**Note (capacity matching):** Under 1:1 a booking gets its assigned driver's car regardless of `capacity`/`type`. Per spec non-goals this is accepted; capacity-aware pairing is out of scope. The fleet editor is where a human reconciles it.

---

## Phase 0 — Schema + migration

### Task 0.1: Add `assignedDriverId` to Vehicle

**Files:**
- Modify: `prisma/schema.prisma` (model `Vehicle`, model `Driver`)

- [ ] **Step 1: Edit the schema** *(HIGH RISK — schema change; get per-turn auth before `migrate`)*

In `model Vehicle` add:
```prisma
  assignedDriverId String?  @unique
  assignedDriver   Driver?  @relation("VehicleDriver", fields: [assignedDriverId], references: [id])
```
In `model Driver` add the back-relation:
```prisma
  assignedVehicle  Vehicle? @relation("VehicleDriver")
```
Leave `isDutyVehicle` in place; add a comment `// DEPRECATED: retired from logic (car=driver), kept for migration safety`.

- [ ] **Step 2: Dry-run the migration diff**

Run: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`
Expected: an additive `ALTER TABLE "Vehicle" ADD COLUMN "assignedDriverId"` + unique index, no drops.

- [ ] **Step 3: Create + apply the migration** *(needs per-turn auth)*

Run: `npx prisma migrate dev --name vehicle_assigned_driver`
Expected: migration applied, `Generated Prisma Client`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (new fields available on the client).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): Vehicle.assignedDriverId for 1:1 car=driver"
```

---

## Phase 1 — Pairing helpers + backfill

### Task 1.1: Pairing helpers (TDD)

**Files:**
- Create: `lib/booking/fleet.ts`
- Test: `lib/booking/fleet.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { pairCarsToDrivers, vehicleDriverMap } from "./fleet";

describe("pairCarsToDrivers", () => {
  it("pairs each car with a distinct driver in stable order", () => {
    const cars = [{ id: "c2" }, { id: "c1" }];
    const drivers = [{ id: "d2" }, { id: "d1" }];
    const pairs = pairCarsToDrivers(cars, drivers);
    // sorted by id: c1->d1, c2->d2
    expect(pairs).toEqual([
      { vehicleId: "c1", driverId: "d1" },
      { vehicleId: "c2", driverId: "d2" },
    ]);
  });

  it("leaves extra cars unpaired when drivers run out", () => {
    const pairs = pairCarsToDrivers([{ id: "c1" }, { id: "c2" }], [{ id: "d1" }]);
    expect(pairs).toEqual([{ vehicleId: "c1", driverId: "d1" }]);
  });
});

describe("vehicleDriverMap", () => {
  it("maps vehicleId -> assignedDriverId, skipping unpaired", () => {
    const m = vehicleDriverMap([
      { id: "c1", assignedDriverId: "d1" },
      { id: "c2", assignedDriverId: null },
    ]);
    expect(m.get("c1")).toBe("d1");
    expect(m.has("c2")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run --no-file-parallelism lib/booking/fleet.test.ts`
Expected: FAIL — `Cannot find module './fleet'`.

- [ ] **Step 3: Implement `lib/booking/fleet.ts`**

```typescript
// Car = driver pairing helpers (1:1). The pairing is persisted on
// Vehicle.assignedDriverId; these helpers compute a default pairing and a
// fast lookup used by the matcher and the schedule board.

export interface CarRef { id: string }
export interface DriverRef { id: string }
export interface VehicleDriverPair { vehicleId: string; driverId: string }

/**
 * Stable default pairing: sort both by id, zip. Extra cars (more cars than
 * drivers) are left unpaired; extra drivers are ignored.
 */
export function pairCarsToDrivers(cars: CarRef[], drivers: DriverRef[]): VehicleDriverPair[] {
  const c = [...cars].sort((a, b) => a.id.localeCompare(b.id));
  const d = [...drivers].sort((a, b) => a.id.localeCompare(b.id));
  const pairs: VehicleDriverPair[] = [];
  for (let i = 0; i < c.length && i < d.length; i++) {
    pairs.push({ vehicleId: c[i]!.id, driverId: d[i]!.id });
  }
  return pairs;
}

/** vehicleId -> assignedDriverId, omitting unpaired cars. */
export function vehicleDriverMap(
  vehicles: { id: string; assignedDriverId: string | null }[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of vehicles) if (v.assignedDriverId) m.set(v.id, v.assignedDriverId);
  return m;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run --no-file-parallelism lib/booking/fleet.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/booking/fleet.ts lib/booking/fleet.test.ts
git commit -m "feat(fleet): car<->driver pairing helpers"
```

### Task 1.2: Backfill script

**Files:**
- Create: `scripts/pair-cars-drivers.ts`

- [ ] **Step 1: Write the script**

```typescript
// Auto-pair active vehicles <-> active drivers (1:1), writing
// Vehicle.assignedDriverId. Idempotent: only fills cars that have no driver
// yet and drivers not already paired. Run: npx tsx scripts/pair-cars-drivers.ts
import { PrismaClient } from "@prisma/client";
import { pairCarsToDrivers } from "../lib/booking/fleet";

const prisma = new PrismaClient();

async function main() {
  const vehicles = await prisma.vehicle.findMany({ where: { isActive: true }, select: { id: true, assignedDriverId: true } });
  const drivers = await prisma.driver.findMany({ where: { isActive: true }, select: { id: true } });

  const takenDrivers = new Set(vehicles.map((v) => v.assignedDriverId).filter(Boolean) as string[]);
  const freeCars = vehicles.filter((v) => !v.assignedDriverId);
  const freeDrivers = drivers.filter((d) => !takenDrivers.has(d.id));

  const pairs = pairCarsToDrivers(freeCars, freeDrivers);
  for (const p of pairs) {
    await prisma.vehicle.update({ where: { id: p.vehicleId }, data: { assignedDriverId: p.driverId } });
  }
  console.log(`paired ${pairs.length} car(s); ${freeCars.length - pairs.length} car(s) still unpaired`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/pair-cars-drivers.ts`
Expected: `paired N car(s); …`.

- [ ] **Step 3: Verify in DB**

Run: `npx tsx -e "import {PrismaClient} from '@prisma/client';(async()=>{const p=new PrismaClient();const v=await p.vehicle.findMany({where:{isActive:true},select:{registrationNumber:true,assignedDriver:{select:{user:{select:{name:true}}}}}});console.table(v.map(x=>({car:x.registrationNumber,driver:x.assignedDriver?.user.name??'—'})));await p.\$disconnect();})()"`
Expected: every active car shows a driver (or `—` if drivers ran out).

- [ ] **Step 4: Commit**

```bash
git add scripts/pair-cars-drivers.ts
git commit -m "chore(scripts): auto-pair cars to drivers"
```

---

## Phase 2 — `/admin/fleet` editor

### Task 2.1: `setVehicleDriverAction`

**Files:**
- Create: `lib/booking/fleet-actions.ts`

- [ ] **Step 1: Write the action**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import type { ActionResult } from "@/lib/booking/actions";

// Set (or clear) a car's assigned driver. Enforces 1:1: if the driver is
// already on another car, that car is cleared first (a driver owns one car).
export async function setVehicleDriverAction(formData: FormData): Promise<ActionResult> {
  await requireRole("ADMIN");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const raw = String(formData.get("driverId") ?? "");
  const driverId = raw === "" ? null : raw;
  if (!vehicleId) return { ok: false, error: "invalidInput" };

  await prisma.$transaction(async (tx) => {
    if (driverId) {
      // 1:1 — release the driver from any other car first.
      await tx.vehicle.updateMany({ where: { assignedDriverId: driverId, id: { not: vehicleId } }, data: { assignedDriverId: null } });
    }
    await tx.vehicle.update({ where: { id: vehicleId }, data: { assignedDriverId: driverId } });
  });

  revalidatePath("/admin/fleet");
  revalidatePath("/admin/schedule");
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/booking/fleet-actions.ts
git commit -m "feat(fleet): setVehicleDriverAction"
```

### Task 2.2: Fleet editor UI

**Files:**
- Create: `components/admin/fleet-editor.tsx`
- Create: `app/(admin)/admin/fleet/page.tsx`
- Modify: `messages/en.json`, `messages/th.json`

- [ ] **Step 1: Add i18n keys**

In `messages/en.json` add a top-level `"fleet"` block:
```json
  "fleet": {
    "title": "Cars & drivers",
    "description": "Each car has one assigned driver.",
    "car": "Car",
    "driver": "Driver",
    "unpaired": "— no driver —",
    "saved": "Saved"
  },
```
In `messages/th.json`:
```json
  "fleet": {
    "title": "รถและคนขับ",
    "description": "รถแต่ละคันมีคนขับประจำหนึ่งคน",
    "car": "รถ",
    "driver": "คนขับ",
    "unpaired": "— ไม่มีคนขับ —",
    "saved": "บันทึกแล้ว"
  },
```

- [ ] **Step 2: Write the client editor**

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { setVehicleDriverAction } from "@/lib/booking/fleet-actions";

export type FleetCar = { id: string; registrationNumber: string; assignedDriverId: string | null };
export type FleetDriver = { id: string; name: string };

export function FleetEditor({ cars, drivers }: { cars: FleetCar[]; drivers: FleetDriver[] }) {
  const t = useTranslations("fleet");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setDriver(vehicleId: string, driverId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("vehicleId", vehicleId);
      fd.set("driverId", driverId);
      await setVehicleDriverAction(fd);
      router.refresh();
    });
  }

  return (
    <table className="w-full max-w-xl text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-2">{t("car")}</th>
          <th className="py-2">{t("driver")}</th>
        </tr>
      </thead>
      <tbody>
        {cars.map((c) => (
          <tr key={c.id} className="border-b">
            <td className="py-2 font-medium">{c.registrationNumber}</td>
            <td className="py-2">
              <select
                disabled={pending}
                value={c.assignedDriverId ?? ""}
                onChange={(e) => setDriver(c.id, e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2"
              >
                <option value="">{t("unpaired")}</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Write the page**

```tsx
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { FleetEditor } from "@/components/admin/fleet-editor";

export default async function FleetPage() {
  await requireRole("ADMIN");
  const t = await getTranslations("fleet");
  const locale = await getLocale();
  const isThai = locale.toLowerCase().startsWith("th");

  const [cars, drivers] = await Promise.all([
    prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { registrationNumber: "asc" }, select: { id: true, registrationNumber: true, assignedDriverId: true } }),
    prisma.driver.findMany({ where: { isActive: true }, select: { id: true, user: { select: { name: true, thaiName: true } } } }),
  ]);

  const driverOpts = drivers.map((d) => ({
    id: d.id,
    name: (isThai ? d.user.thaiName ?? d.user.name : d.user.name ?? d.user.thaiName) ?? d.id,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <FleetEditor cars={cars} drivers={driverOpts} />
    </div>
  );
}
```

- [ ] **Step 4: Verify build + visit**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. Then load `/admin/fleet`, change a car's driver, confirm it persists on refresh.

- [ ] **Step 5: Commit**

```bash
git add components/admin/fleet-editor.tsx "app/(admin)/admin/fleet/page.tsx" messages/en.json messages/th.json
git commit -m "feat(fleet): /admin/fleet car<->driver editor"
```

---

## Phase 3 — Matcher: vehicle follows the driver's car

The solver (`solveDay`) already picks drivers by rotation/fairness/eligibility — under 1:1 that **is** the car pick. We do NOT rewrite the rotation logic. We change the *persistence* layer to bind `vehicleId = driver's car` and delete the independent vehicle-slot allocation, and we mark a co-driver's own car busy.

### Task 3.1: Bind vehicle = driver's car in the batch path

**Files:**
- Modify: `lib/booking/batch-actions.ts`
- Test: `lib/booking/batch-actions.test.ts` (create if absent)

- [ ] **Step 1: Read the current allocation flow**

Open `lib/booking/batch-actions.ts`. Locate where it (a) loads vehicles + builds the slot table, (b) calls `solveDay`, (c) calls `allocateVehicles`/`buildSlotTable` (from `slot-allocation.ts`) to attach a `vehicleId`, (d) writes `booking.update` with `vehicleId` + driver ids. Note the exact variable names for the per-booking vehicle id.

- [ ] **Step 2: Write a failing integration test for the binding rule**

```typescript
import { describe, it, expect } from "vitest";
import { vehicleForAssignment } from "./batch-actions";

describe("vehicleForAssignment", () => {
  const carOf = new Map([["dA", "vA"], ["dB", "vB"]]); // driver -> their car
  it("returns the primary driver's car", () => {
    expect(vehicleForAssignment("dA", carOf)).toBe("vA");
  });
  it("returns null when the primary driver has no car", () => {
    expect(vehicleForAssignment("dX", carOf)).toBeNull();
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `npx vitest run --no-file-parallelism lib/booking/batch-actions.test.ts`
Expected: FAIL — `vehicleForAssignment` not exported.

- [ ] **Step 4: Add the helper + rewire the write**

In `lib/booking/batch-actions.ts`, add (near the top-level exports):
```typescript
// Car = driver: the booking's vehicle is the PRIMARY driver's assigned car.
// driverCar maps driverId -> vehicleId (from Vehicle.assignedDriverId).
export function vehicleForAssignment(primaryDriverId: string, driverCar: Map<string, string>): string | null {
  return driverCar.get(primaryDriverId) ?? null;
}
```
Then where the vehicle pool is loaded, also build `driverCar`:
```typescript
const driverCar = new Map<string, string>();
for (const v of vehiclesForDay) if (v.assignedDriverId) driverCar.set(v.assignedDriverId, v.id);
```
(Ensure the vehicle query `select`s `assignedDriverId`.)
**Delete** the `allocateVehicles` / `buildSlotTable` slot search. For each `SolverAssignment`, set `vehicleId = vehicleForAssignment(a.primaryDriverId, driverCar)`. If it returns `null` (driver has no car), record an overflow `reason: "NO_SLOT"` for that booking instead of writing it. Mark the co-driver's car unavailable by simply NOT dispatching a second vehicle (the secondary rides along — nothing to allocate).

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run --no-file-parallelism lib/booking/batch-actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Full booking suite**

Run: `npx vitest run --no-file-parallelism lib/booking/`
Expected: PASS (fix any slot-allocation tests now obsolete — see Task 3.3).

- [ ] **Step 7: Commit**

```bash
git add lib/booking/batch-actions.ts lib/booking/batch-actions.test.ts
git commit -m "feat(matcher): batch assignment binds vehicle to driver's car"
```

### Task 3.2: Single-booking path

**Files:**
- Modify: `lib/booking/matching.ts`, `lib/booking/matching-actions.ts`

- [ ] **Step 1: Locate vehicle selection**

In `matching.ts`, find Algorithm 1 (vehicle slot pick). In `matching-actions.ts`, find where the chosen `vehicleId` is written.

- [ ] **Step 2: Replace vehicle selection with the driver's car**

After the driver (`primaryDriverId`) is chosen, set `vehicleId = driverCar.get(primaryDriverId) ?? null` (build `driverCar` from the active-vehicle query's `assignedDriverId`, as in Task 3.1). Remove the independent vehicle-slot search. If the driver has no car → return the existing no-vehicle overflow/result.

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run --no-file-parallelism lib/booking/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/booking/matching.ts lib/booking/matching-actions.ts
git commit -m "feat(matcher): single-booking vehicle follows driver's car"
```

### Task 3.3: Retire obsolete slot-allocation tests

**Files:**
- Modify: `lib/booking/slot-allocation.ts` (keep `bucketsForTrip`/occupancy if still used for display), `lib/booking/slot-allocation.test.ts`

- [ ] **Step 1: Find remaining users of `allocateVehicles`/`buildSlotTable`**

Run: `grep -rn "allocateVehicles\|buildSlotTable\|findSlot" lib/ app/ components/`
Expected: only tests + the now-removed call sites.

- [ ] **Step 2: Delete dead exports + their tests; keep `bucketsForTrip`/`vehicleOccupancyForDay` if still referenced**

Remove `allocateVehicles`, `buildSlotTable`, `findSlot` and their test blocks. Keep any function still imported elsewhere (verify with grep).

- [ ] **Step 3: Run tests**

Run: `npx vitest run --no-file-parallelism lib/booking/`
Expected: PASS, no references to deleted functions.

- [ ] **Step 4: Commit**

```bash
git add lib/booking/slot-allocation.ts lib/booking/slot-allocation.test.ts
git commit -m "refactor(matcher): remove independent vehicle-slot allocation (car=driver)"
```

---

## Phase 4 — Schedule board: car-centric, no "no driver"

### Task 4.1: `reassignVehicleAction` assigns the car's driver

**Files:**
- Modify: `lib/booking/schedule-actions.ts`

- [ ] **Step 1: Rewrite the action body**

Replace the `pickFreeDriver` block + `{ ok, driverless }` return. New logic:
```typescript
// Car = driver: dropping a booking on a car assigns the car AND its assigned
// driver. Block only if the car is busy or has no assigned driver.
export async function reassignVehicleAction(formData: FormData): Promise<{ ok: false; error: string } | { ok: true }> {
  await requireRole("ADMIN");
  const bookingId = String(formData.get("bookingId") ?? "");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  if (!bookingId || !vehicleId) return { ok: false, error: "invalidInput" };

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, error: "bookingNotFound" };

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { assignedDriverId: true } });
  if (!vehicle?.assignedDriverId) return { ok: false, error: "noAssignedDriver" };

  if (vehicleId !== booking.vehicleId) {
    const conflict = await prisma.booking.findFirst({
      where: { id: { not: bookingId }, vehicleId, status: { in: ["APPROVED", "ASSIGNED"] }, startAt: { lt: booking.endAt }, endAt: { gt: booking.startAt } },
      select: { id: true },
    });
    if (conflict) return { ok: false, error: "vehicleBusy" };
  }

  const driverId = vehicle.assignedDriverId;
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { vehicleId, primaryDriverId: driverId, status: "ASSIGNED", driverScheduleStatus: "CONFIRMED", decidedAt: new Date() },
    });
    await tx.driver.update({ where: { id: driverId }, data: { lastAssignedAt: booking.startAt } });
  });

  revalidatePath("/admin/schedule");
  return { ok: true };
}
```
Remove the now-unused `pickFreeDriver`/`FreeDriverInput`/`loadWeightedEarnings` imports if no longer referenced.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/booking/schedule-actions.ts
git commit -m "feat(schedule): drop assigns car + its fixed driver (car=driver)"
```

### Task 4.2: Board shows the car's driver; remove driverless UI

**Files:**
- Modify: `app/(admin)/admin/schedule/page.tsx`, `components/admin/scheduler-board.tsx`, `messages/en.json`, `messages/th.json`

- [ ] **Step 1: Page passes each car's driver name + duty car**

In `app/(admin)/admin/schedule/page.tsx`: extend the vehicle query `select` with `assignedDriver: { select: { user: { select: { name: true, thaiName: true } } } }` and `assignedDriverId`. Build `SchedulerVehicle` to include `driverName: string | null`. Derive `dutyVehicleId` = the active vehicle whose `assignedDriverId === onCall.driverId`.

- [ ] **Step 2: Board row shows "label · driver"; remove driverless concept**

In `components/admin/scheduler-board.tsx`:
- Extend `SchedulerVehicle` with `driverName: string | null`.
- In `CarRow`, render the label as `{label} · {vehicle.driverName ?? t("noAssignedDriver")}`.
- Delete `dropNote`/`setDropNote`, the amber banner, and the `res.driverless` branch in `reassign()`. Map errors: `vehicleBusy → dropConflict`, `noAssignedDriver → noAssignedDriver`, else `dropFailed`.
- `TimelineBlock`: every block now has a driver; keep the red border only for the degenerate "car has no assigned driver" case (booking on a car whose `driverName` is null).
- For a >400 km TJW block whose booking has a `secondaryDriverId`, append a `t("coDriver")` marker (pass `hasCoDriver: boolean` per booking from the page).

- [ ] **Step 3: i18n**

`messages/en.json` scheduler: add `"noAssignedDriver": "No driver set for this car — set one in Cars & drivers.", "coDriver": "+ co-driver"`. `messages/th.json`: `"noAssignedDriver": "รถคันนี้ยังไม่มีคนขับประจำ — ตั้งค่าในเมนูรถและคนขับ", "coDriver": "+ คนขับเสริม"`.

- [ ] **Step 4: Typecheck + lint + visual**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. Then reload `/admin/schedule`: rows show "A · ‹driver›"; dropping a queue card on a car lands green with that driver; no "no driver" amber/red for paired cars.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/schedule/page.tsx" components/admin/scheduler-board.tsx messages/en.json messages/th.json
git commit -m "feat(schedule): car-centric board, driver shown per car, co-driver marker"
```

---

## Phase 5 — Backfill existing bookings

### Task 5.1: Re-point future bookings' drivers to their car's driver

**Files:**
- Create: `scripts/backfill-booking-drivers.ts`

- [ ] **Step 1: Write the script**

```typescript
// Car = driver migration: for APPROVED/ASSIGNED bookings from today forward
// that have a vehicle, set primaryDriverId = that vehicle's assignedDriver.
// Historical/completed bookings are left untouched. Idempotent.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const bookings = await prisma.booking.findMany({
    where: { status: { in: ["APPROVED", "ASSIGNED"] }, startAt: { gte: today }, vehicleId: { not: null } },
    select: { id: true, vehicleId: true, primaryDriverId: true, vehicle: { select: { assignedDriverId: true } } },
  });
  let changed = 0;
  for (const b of bookings) {
    const want = b.vehicle?.assignedDriverId ?? null;
    if (want && want !== b.primaryDriverId) {
      await prisma.booking.update({ where: { id: b.id }, data: { primaryDriverId: want } });
      changed++;
    }
  }
  console.log(`re-pointed ${changed}/${bookings.length} booking(s) to their car's driver`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/backfill-booking-drivers.ts`
Expected: `re-pointed N/M booking(s) …`.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-booking-drivers.ts
git commit -m "chore(scripts): backfill booking drivers to car's driver"
```

---

## Phase 6 — Full verification

### Task 6.1: Green-light the whole suite

- [ ] **Step 1: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npx next build`
Expected: PASS, no SSR errors.

- [ ] **Step 2: Booking unit/integration tests**

Run: `npx vitest run --no-file-parallelism lib/booking/`
Expected: PASS — including updated matcher/simulation tests (driver follows car; co-driver only on >400 km TJW; duty car excluded; fairness order by car's driver).

- [ ] **Step 3: Behavioral seed check**

Run: `npx tsx scripts/seed-free-driver-day.ts` then load `/admin/schedule`. Confirm:
- every car row shows its driver,
- a queue drop lands green with that car's driver,
- the wern badge sits on the on-call driver's car,
- a >400 km TJW shows the "+ co-driver" marker.

- [ ] **Step 4: Final commit (docs/notes if any)**

```bash
git add -A
git commit -m "test(car=driver): verify full suite + behavioral checks"
```

---

## Self-review

**Spec coverage:** schema (§5 → Task 0.1) · pairing+editor (§6 → 1.1/1.2/2.1/2.2) · matcher rewrite + co-driver + duty + fairness (§7 → 3.1/3.2/3.3) · board (§8 → 4.1/4.2) · data backfill (§9 → 5.1) · i18n (§10 → 2.2/4.2) · testing (§11 → 6.1) · phases (§12 → Phase 0–6). All covered.

**Open questions carried from spec §14:** (a) unpaired car → excluded from auto-match (Task 3.1 records `NO_SLOT`) and shown as needs-setup on the board (Task 4.2). (b) co-driver ledger → stamp `lastAssignedAt` on commit (existing `commitTrip` already stamps `earningsScore`; secondary stamping unchanged). Confirm both during execution.

**Placeholder scan:** none — every code step has real code.

**Type consistency:** `vehicleForAssignment(primaryDriverId, driverCar: Map<string,string>)`, `vehicleDriverMap → Map<string,string>`, `pairCarsToDrivers → VehicleDriverPair[]`, `reassignVehicleAction → {ok:false;error} | {ok:true}`, `SchedulerVehicle.driverName` used consistently across page + board.
