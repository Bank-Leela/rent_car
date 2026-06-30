# TJW Assignment by Request Order — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign TJW (multi-day out-of-province) trips in global request-date order — earliest `createdAt` first, fairest eligible driver each time — via a dedicated pure pass, removing TJW from the per-day solver. OT/WERN/NORMAL unchanged.

**Architecture:** New pure `solveTjwByRequest` (mirrors `solveDay`'s shape) sorts pending TJW by `createdAt`, picks each a driver with the existing `rankForRotation(lastTjwAt)` + provisional stamping, and pairs a >400 km co-driver. A new admin action runs it; the daily batch query excludes TJW; `solveDay` then sees TJW only as `activeTjwCommitments` (already supported).

**Tech Stack:** TypeScript, Prisma, vitest, Next.js server actions, next-intl.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-26-tjw-request-order-assignment-design.md`. Read `docs/scheduling-algorithm.md` first.
- **Only TJW changes.** OT/WERN/NORMAL keep the existing algorithm; no schema/migration.
- Driver pick is **unchanged** (`rankForRotation` on `lastTjwAt` + earnings); only the **order** (global `createdAt`) and the **location** (out of `solveDay`) change.
- Idempotent: assign only **unassigned** pending TJW; **already-assigned TJW are fixed commitments**, never moved.
- `LONG_TRIP_KM = 400` (`lib/booking/classification.ts`) → needs a co-driver.
- Determinism: tie-break `createdAt` by `bookingId`.
- Verify after `.ts`: `npx tsc --noEmit`; tests `npx vitest run --no-file-parallelism`; scheduler gate `npx tsx scripts/simulate-cr07.ts --scenario=<...>` (rule-check counters 0).

---

### Task 1: Pure core — `solveTjwByRequest`

**Files:**
- Create: `lib/booking/tjw-request-solver.ts`
- Test: `lib/booking/tjw-request-solver.test.ts`

**Interfaces:**
- Consumes: `DriverRotationState` (`rotations.ts`), `rankForRotation` (`rotations.ts`), `TjwCommitment` (`batch-solver.ts`), `LONG_TRIP_KM` (`classification.ts`).
- Produces: `solveTjwByRequest(input: TjwSolveInput): TjwSolveResult` (types below).

- [ ] **Step 1: Write the failing tests** — `lib/booking/tjw-request-solver.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { solveTjwByRequest, type TjwSolveInput } from "./tjw-request-solver";
import type { DriverRotationState } from "./rotations";

const D = (s: string) => new Date(s);
const drv = (id: string, o: Partial<DriverRotationState> = {}): DriverRotationState => ({
  driverId: id, lastTjwAt: null, lastOtAt: null, lastDutyAt: null, earningsScore: 0, lastAssignedAt: null, ...o,
});
const req = (bookingId: string, createdAt: string, startAt: string, endAt: string, km: number | null = 100) => ({
  bookingId, createdAt: D(createdAt), startAt: D(startAt), endAt: D(endAt), estimatedDistance: km,
});
const base = (over: Partial<TjwSolveInput>): TjwSolveInput => ({
  requests: [], drivers: [drv("A"), drv("B")],
  driverCar: new Map([["A", "carA"], ["B", "carB"]]),
  existingCommitments: [], dutyByDay: new Map(), ...over,
});

describe("solveTjwByRequest", () => {
  it("orders by createdAt, not trip date (earlier request wins)", () => {
    const out = solveTjwByRequest(base({ requests: [
      req("late-trip-early-req", "2026-06-25", "2026-07-10T08:00", "2026-07-11T18:00"),
      req("early-trip-late-req", "2026-06-26", "2026-07-02T08:00", "2026-07-03T18:00"),
    ]}));
    // Both non-overlapping → both placed; the 25-Jun request is assigned first.
    expect(out.overflows).toHaveLength(0);
    const first = out.assignments[0]!;
    expect(first.bookingId).toBe("late-trip-early-req");
  });

  it("rotation bump sends the 2nd request to the next-fairest driver (A then B)", () => {
    // Two overlapping TJWs forces distinct drivers; A (oldest) first, then B.
    const out = solveTjwByRequest(base({ requests: [
      req("r1", "2026-06-25", "2026-07-10T08:00", "2026-07-12T18:00"),
      req("r2", "2026-06-26", "2026-07-10T08:00", "2026-07-12T18:00"),
    ]}));
    expect(out.assignments.map((a) => [a.bookingId, a.primaryDriverId])).toEqual([
      ["r1", "A"], ["r2", "B"],
    ]);
  });

  it("excludes a driver busy on an overlapping committed span", () => {
    const out = solveTjwByRequest(base({
      drivers: [drv("A")], driverCar: new Map([["A", "carA"]]),
      existingCommitments: [{ driverId: "A", startAt: D("2026-07-10T00:00"), endAt: D("2026-07-13T00:00") }],
      requests: [req("r1", "2026-06-25", "2026-07-11T08:00", "2026-07-12T18:00")],
    }));
    expect(out.overflows).toEqual([{ bookingId: "r1", reason: "NO_PRIMARY_DRIVER" }]);
  });

  it("excludes the duty driver on a spanned day", () => {
    const dayMs = D("2026-07-10T00:00").getTime();
    const out = solveTjwByRequest(base({
      drivers: [drv("A")], driverCar: new Map([["A", "carA"]]),
      dutyByDay: new Map([[dayMs, "A"]]),
      requests: [req("r1", "2026-06-25", "2026-07-10T08:00", "2026-07-11T18:00")],
    }));
    expect(out.overflows).toEqual([{ bookingId: "r1", reason: "NO_PRIMARY_DRIVER" }]);
  });

  it("assigns a co-driver for >400km, overflows when none free", () => {
    const ok = solveTjwByRequest(base({
      requests: [req("long", "2026-06-25", "2026-07-10T08:00", "2026-07-12T18:00", 700)],
    }));
    expect(ok.assignments[0]!.secondaryDriverId).toBe("B");
    const none = solveTjwByRequest(base({
      drivers: [drv("A")], driverCar: new Map([["A", "carA"]]),
      requests: [req("long", "2026-06-25", "2026-07-10T08:00", "2026-07-12T18:00", 700)],
    }));
    expect(none.overflows).toEqual([{ bookingId: "long", reason: "NO_SECONDARY_DRIVER" }]);
  });

  it("a driver may take two non-overlapping TJWs", () => {
    const out = solveTjwByRequest(base({
      drivers: [drv("A")], driverCar: new Map([["A", "carA"]]),
      requests: [
        req("r1", "2026-06-25", "2026-07-02T08:00", "2026-07-03T18:00"),
        req("r2", "2026-06-26", "2026-07-10T08:00", "2026-07-11T18:00"),
      ],
    }));
    expect(out.overflows).toHaveLength(0);
    expect(out.assignments.every((a) => a.primaryDriverId === "A")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing): `npx vitest run lib/booking/tjw-request-solver.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement `lib/booking/tjw-request-solver.ts`:**
```ts
import { startOfDay } from "date-fns";
import { rankForRotation, type DriverRotationState } from "./rotations";
import type { TjwCommitment } from "./batch-solver";
import { LONG_TRIP_KM } from "./classification";

export interface TjwRequestInput {
  bookingId: string;
  createdAt: Date;
  startAt: Date;
  endAt: Date;
  estimatedDistance: number | null;
}

export interface TjwSolveInput {
  requests: TjwRequestInput[];
  drivers: DriverRotationState[];
  driverCar: Map<string, string>;
  existingCommitments: TjwCommitment[];
  dutyByDay: Map<number, string>; // day-midnight ms → duty driverId
}

export interface TjwAssignment {
  bookingId: string;
  primaryDriverId: string;
  secondaryDriverId: string | null;
}

export interface TjwSolveResult {
  assignments: TjwAssignment[];
  overflows: { bookingId: string; reason: "NO_PRIMARY_DRIVER" | "NO_SECONDARY_DRIVER" }[];
}

type Span = { startAt: Date; endAt: Date };
const overlaps = (a: Span, b: Span) => a.startAt < b.endAt && b.startAt < a.endAt;

// Every local-midnight day a span touches (half-open on the end, like daysSpanned).
function daysOf(span: Span): number[] {
  const out: number[] = [];
  let cur = startOfDay(span.startAt);
  const last = startOfDay(span.endAt);
  while (cur <= last) {
    const next = new Date(cur); next.setDate(next.getDate() + 1);
    if (span.startAt < next && span.endAt > cur) out.push(cur.getTime());
    cur = next;
  }
  return out;
}

export function solveTjwByRequest(input: TjwSolveInput): TjwSolveResult {
  const assignments: TjwAssignment[] = [];
  const overflows: TjwSolveResult["overflows"] = [];

  // Mutable rotation snapshot so provisional bumps affect later requests.
  const state = new Map(input.drivers.map((d) => [d.driverId, { ...d }]));
  // Committed spans per driver (seeded from fixed commitments; grown as we assign).
  const busy = new Map<string, Span[]>();
  for (const c of input.existingCommitments) {
    const arr = busy.get(c.driverId) ?? [];
    arr.push({ startAt: c.startAt, endAt: c.endAt });
    busy.set(c.driverId, arr);
  }

  const free = (driverId: string, span: Span): boolean => {
    if (!input.driverCar.has(driverId)) return false; // car=driver: must be paired
    if (daysOf(span).some((d) => input.dutyByDay.get(d) === driverId)) return false; // duty
    return !(busy.get(driverId) ?? []).some((s) => overlaps(s, span));
  };

  const sorted = [...input.requests].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.bookingId.localeCompare(b.bookingId),
  );

  for (const r of sorted) {
    const span: Span = { startAt: r.startAt, endAt: r.endAt };
    const eligible = input.drivers.map((d) => state.get(d.driverId)!).filter((d) => free(d.driverId, span));
    const ranked = rankForRotation(eligible, (d) => d.lastTjwAt);
    const primary = ranked[0];
    if (!primary) { overflows.push({ bookingId: r.bookingId, reason: "NO_PRIMARY_DRIVER" }); continue; }

    let secondary: string | null = null;
    if ((r.estimatedDistance ?? 0) > LONG_TRIP_KM) {
      const co = ranked.find((id) => id !== primary);
      if (!co) { overflows.push({ bookingId: r.bookingId, reason: "NO_SECONDARY_DRIVER" }); continue; }
      secondary = co;
    }

    assignments.push({ bookingId: r.bookingId, primaryDriverId: primary, secondaryDriverId: secondary });
    // Provisional bump + occupancy so the next request sees the change.
    for (const id of [primary, ...(secondary ? [secondary] : [])]) {
      const d = state.get(id)!;
      d.lastTjwAt = r.startAt;
      d.earningsScore += 1; // coarse fairness nudge; finalised by the real stamp on write
      const arr = busy.get(id) ?? [];
      arr.push(span);
      busy.set(id, arr);
    }
  }
  return { assignments, overflows };
}
```

- [ ] **Step 4: Run — expect PASS.** `npx vitest run lib/booking/tjw-request-solver.test.ts --no-file-parallelism`
- [ ] **Step 5: Typecheck** — `npm run typecheck`.
- [ ] **Step 6: Commit** — `feat(scheduler): pure TJW-by-request-order solver`

---

### Task 2: Remove TJW from the daily batch

**Files:**
- Modify: `lib/booking/batch-actions.ts` (the pending query, ~L49-56)

**Interfaces:**
- Consumes: nothing new.
- Produces: `runBatchAction` no longer solves TJW (handled by Task 3's pass).

- [ ] **Step 1: Exclude TJW from the pending query.** In `lib/booking/batch-actions.ts`, the pending `findMany` `where` (`status: "APPROVED", primaryDriverId: null, …`) — add `jobType: { not: "TJW" }`:
```ts
    where: {
      status: "APPROVED",
      primaryDriverId: null,
      jobType: { not: "TJW" },
      startAt: { gte: dayStart, lt: dayEnd },
    },
```
`solveDay` already handles an empty TJW category, and `activeTjwCommitments` still locks TJW-assigned drivers away — no other change here.

- [ ] **Step 2: Verify the solver still works for non-TJW** — `npx vitest run lib/booking/batch-solver.test.ts lib/booking/solver-invariants.test.ts --no-file-parallelism` → green (TJW cases there exercise `solveDay` directly with explicit inputs and are unaffected; if any test fed a TJW through `runBatchAction`, none do — `solveDay` is tested directly).
- [ ] **Step 3: Typecheck** — `npm run typecheck`.
- [ ] **Step 4: Commit** — `feat(scheduler): daily batch no longer assigns TJW (handled by request-order pass)`

---

### Task 3: Action — `assignTjwByRequestOrder`

**Files:**
- Create: `lib/booking/tjw-request-actions.ts`
- Test: extend `lib/booking/schedule-actions.test.ts` pattern or add `lib/booking/tjw-request-actions.test.ts` (DB-seeded, like `actions.test.ts`)

**Interfaces:**
- Consumes: `solveTjwByRequest` (Task 1); `requireRole`, `prisma`, `driverVehicleMap` (`fleet.ts`), `loadWeightedEarnings` (`earnings.ts`), `recomputeRotationStamp` (`rotation-stamp.ts`), `COMMITTED_STATUSES`.
- Produces: `assignTjwByRequestOrder(): Promise<{ ok: true; assigned: number; overflows: {...}[] } | { ok: false; error: string }>`.

- [ ] **Step 1: Implement the action** (mirror `runBatchAction`'s load → solve → write/stamp). In `lib/booking/tjw-request-actions.ts`:
  - `requireRole("ADMIN")`.
  - Load **all pending** TJW: `prisma.booking.findMany({ where: { jobType: "TJW", status: "APPROVED", primaryDriverId: null }, select: { id, createdAt, startAt, endAt, estimatedDistance } })` → `requests`.
  - Load drivers + rotation state (`DriverRotationState[]`) + `earnings` (`loadWeightedEarnings`) exactly as `runBatchAction` does.
  - `driverCar = driverVehicleMap(vehicles)`.
  - `existingCommitments`: all **already-assigned** TJW (`status: { in: COMMITTED_STATUSES }, jobType: "TJW", primaryDriverId/secondaryDriverId`) → `TjwCommitment[]` (one per primary + secondary), so confirmed TJW are fixed.
  - `dutyByDay`: `prisma.onCallShift.findMany` over the span of the requests → `Map<dayMs, driverId>`.
  - Call `solveTjwByRequest({ requests, drivers, driverCar, existingCommitments, dutyByDay })`.
  - In a `$transaction`: for each assignment, `tx.booking.update({ where:{id}, data:{ primaryDriverId, secondaryDriverId?, status:"ASSIGNED", decidedAt: new Date() } })` and bump stamps via the **same** `stampPrimary`/`stampSecondary`/`recomputeRotationStamp` helpers `runBatchAction` uses (jobType "TJW", stamp = the trip's `startAt`).
  - `revalidatePath("/admin/batch")` + `/admin/schedule`.
  - Return `{ ok: true, assigned: assignments.length, overflows: result.overflows }`.

- [ ] **Step 2: DB test** (seeded dev DB) `tjw-request-actions.test.ts`: insert two APPROVED TJW with different `createdAt` (earlier request = later trip), run the action, assert both ASSIGNED, the earlier-`createdAt` one assigned first / to the fairest driver, and `lastTjwAt` bumped. Clean up by marker (mirror `actions.test.ts` `afterAll`).
- [ ] **Step 3: Run — expect PASS** (seeded DB): `npx vitest run lib/booking/tjw-request-actions.test.ts --no-file-parallelism`
- [ ] **Step 4: Typecheck** — `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(scheduler): assignTjwByRequestOrder action (load → solve → write/stamp)`

---

### Task 4: Admin trigger

**Files:**
- Modify: the batch admin page (`app/(admin)/admin/batch/page.tsx`) + a small form (mirror `components/forms/batch-run-form.tsx`)
- Modify: `messages/{en,th}.json`

- [ ] **Step 1: Add a button** that calls `assignTjwByRequestOrder` (a server-action form like `batch-run-form.tsx`), labelled `t("assignTjw")`, showing `assigned` + any overflow reasons on return. Add `adminBatch.assignTjw` (+ result/overflow labels) to en + th.
- [ ] **Step 2: Typecheck** — `npm run typecheck`.
- [ ] **Step 3: Commit** — `feat(admin): button to assign TJW by request order`

---

### Task 5: Rule doc + simulate + full verification

**Files:**
- Modify: `docs/scheduling-algorithm.md`; `scripts/simulate-cr07.ts` (optional scenario)

- [ ] **Step 1: Doc.** In `docs/scheduling-algorithm.md`, document the TJW-by-request-order pass: pending TJW sorted by `createdAt` (cross-day), fairest eligible driver each (rotation bump → next-fairest), confirmed TJW fixed; and that `solveDay` no longer assigns TJW (sees it as commitments).
- [ ] **Step 2: Simulate (optional).** Add a `--tjw-request-order` path (or a scenario) to `scripts/simulate-cr07.ts` that routes TJW through `solveTjwByRequest`; confirm rule-check counters 0 (no driver double-booked across spans).
- [ ] **Step 3: Full verify.** `npm run typecheck` clean; `npx vitest run --no-file-parallelism` all green; `npx tsx scripts/simulate-cr07.ts --scenario=mixed` rule-check 0.
- [ ] **Step 4: Commit** — `docs(scheduling): TJW assigned by request order; solveDay drops TJW`

---

## Self-Review

**Spec coverage:** §3 pure solver (T1) ✓; §4 integration — action (T3) + daily-batch TJW exclusion (T2) + trigger (T4) ✓; §5 idempotency — `existingCommitments` = confirmed TJW, only unassigned solved (T1 + T3) ✓; §6 edge cases — overflow reasons, duty exclusion, non-overlapping reuse, tie-break (T1 tests) ✓; §7 testing (T1 unit, T3 DB, T5 simulate + regression) ✓; §8 out-of-scope respected (no schema, no OT/WERN/NORMAL change, separate action) ✓.

**Placeholder scan:** full code for the pure solver + tests (T1) + the batch-query change (T2); T3/T4 reference exact existing helpers (`stampPrimary`/`stampSecondary`/`recomputeRotationStamp`, `driverVehicleMap`, `loadWeightedEarnings`, `batch-run-form.tsx`) to mirror — read-then-apply, since `runBatchAction`'s load block is long and reused verbatim, not re-derived.

**Type consistency:** `TjwSolveInput`/`TjwAssignment`/`TjwRequestInput` identical across T1↔T3; `DriverRotationState` + `rankForRotation(_, d => d.lastTjwAt)` + `TjwCommitment` reused from the existing modules; overflow reasons `NO_PRIMARY_DRIVER`/`NO_SECONDARY_DRIVER` match the existing `OverflowReason` enum values.

**Note:** `earningsScore += 1` in the pure solver is a coarse provisional nudge for in-run fairness ordering only; the authoritative earnings/rotation are recomputed on write (T3) via the existing stamp helpers — same split the daily batch already uses.
</content>
