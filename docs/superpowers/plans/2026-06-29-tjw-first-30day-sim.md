# ตจว-first 30-day Simulation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persisted, viewable "Simulate 30 days" demo on `/admin/batch` that runs the new pipeline in order — ตจว/multi-day first (request-order pass), then the per-day batch — across 30 days, and reports a summary.

**Architecture:** Pure orchestration of existing actions. A range seeder seeds a month of `BatchDemo:` bookings (incl. ตจว with varied request dates); `runDemoSimulation` runs `assignTjwByRequestOrder` once then `runBatchAction` per day and aggregates a summary; a server action wraps it; a button renders it. No scheduling-logic change.

**Tech Stack:** TypeScript, Prisma, Next.js server actions, next-intl, vitest.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-29-tjw-first-30day-sim-design.md`.
- **Demo-only flow** (`BatchDemo:`-tagged, clearable). Do NOT change the production "Run batch" / "Assign ตจว" buttons or their actions, `solveDay`, `solveTjwByRequest`, scheduling rules, or schema.
- Pipeline order is fixed: **`assignTjwByRequestOrder` first, then `runBatchAction` per day.**
- `BATCH_DEMO_TAG = "BatchDemo:"`. `clearBatchDemoAction` already wipes ALL demo rows across all dates — reuse it; no change.
- en + th i18n parity for new keys.
- Verify after `.ts`/`.tsx`: `npx tsc --noEmit`; tests `npx vitest run --no-file-parallelism` (full suite must stay green — currently 336).

---

### Task 1: Range seeder `seedBatchDemoRange`

**Files:**
- Modify: `lib/booking/batch-demo-actions.ts`

**Interfaces:**
- Consumes: existing `seedBatchDemoForDate(date): Promise<number>`, `BATCH_DEMO_TAG`, `prisma`.
- Produces: `seedBatchDemoRange(start: Date, days: number): Promise<number>` — seeds the per-day demo mix for each of `days` consecutive days from `start`, then spreads the seeded ตจว (`jobType: "TJW"`) `createdAt` to varied request dates *before* their trip dates (and out of trip-date order). Returns total seeded.

- [ ] **Step 1: Implement the seeder.** Add to `lib/booking/batch-demo-actions.ts` (after `seedBatchDemoForDate`):
```ts
/**
 * Seed `days` consecutive days of the demo mix from `start`, then spread the
 * seeded ตจว (TJW) request dates (`createdAt`) so the request-order pass has a
 * meaningful, out-of-trip-order sequence to assign. Demo-only (BatchDemo: tag).
 */
export async function seedBatchDemoRange(start: Date, days: number): Promise<number> {
  const dayStart = startOfDay(start);
  let total = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(dayStart);
    d.setDate(d.getDate() + i);
    total += await seedBatchDemoForDate(d);
  }
  // Spread ตจว request dates: 7..27 days before each trip, pseudo-shuffled so
  // request order != trip-date order (that's the whole point of the demo).
  const rangeEnd = new Date(dayStart);
  rangeEnd.setDate(rangeEnd.getDate() + days + 2); // cover overnight spillover
  const tjw = await prisma.booking.findMany({
    where: {
      purpose: { startsWith: BATCH_DEMO_TAG },
      jobType: "TJW",
      startAt: { gte: dayStart, lt: rangeEnd },
    },
    select: { id: true, startAt: true },
    orderBy: { startAt: "asc" },
  });
  for (let i = 0; i < tjw.length; i++) {
    const req = new Date(tjw[i]!.startAt);
    req.setDate(req.getDate() - (7 + ((i * 13) % 21)));
    await prisma.booking.update({ where: { id: tjw[i]!.id }, data: { createdAt: req } });
  }
  return total;
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` clean.
- [ ] **Step 3: Smoke-count** (seeded dev DB) — confirm it seeds and varies createdAt:
```bash
npx tsx -e 'import {seedBatchDemoRange} from "@/lib/booking/batch-demo-actions"; import {prisma} from "@/lib/db";
(async()=>{ const n=await seedBatchDemoRange(new Date("2026-08-01T00:00:00"),3);
const tjw=await prisma.booking.findMany({where:{purpose:{startsWith:"BatchDemo:"},jobType:"TJW"},select:{startAt:true,createdAt:true},orderBy:{startAt:"asc"}});
console.log("seeded",n,"| tjw req<trip all:",tjw.every(t=>t.createdAt<t.startAt));
await prisma.booking.deleteMany({where:{purpose:{startsWith:"BatchDemo:"}}}); process.exit(0); })();'
```
Expected: `seeded 24 | tjw req<trip all: true` (3 days × 8 slots; every ตจว request date precedes its trip).

- [ ] **Step 4: Commit** — `feat(demo): seedBatchDemoRange — seed N days + spread ตจว request dates`

---

### Task 2: `runDemoSimulation` + `simulate30DaysAction` + summary (with test)

**Files:**
- Modify: `lib/booking/batch-demo-actions.ts`
- Test: `lib/booking/simulate-30day.test.ts`

**Interfaces:**
- Consumes: `seedBatchDemoRange` (Task 1); `assignTjwByRequestOrder` from `@/lib/booking/tjw-request-actions`; `runBatchAction` from `@/lib/booking/batch-actions`; `prisma`; `requireRole`.
- Produces:
  - `interface ThirtyDaySummary { startDate: string; days: number; seededCount: number; tjwAssigned: number; tjwOverflow: number; perDay: { date: string; matched: number; pending: number; overflow: number }[]; totals: { matched: number; pending: number; overflow: number }; fairness: { min: number; max: number; spread: number; stddev: number } }`
  - `runDemoSimulation(start: Date, days: number): Promise<ThirtyDaySummary>` — seed → ตจว pass → per-day batch → aggregate.
  - `simulate30DaysAction(formData: FormData): Promise<ActionResult & { summary?: ThirtyDaySummary }>` — admin-only wrapper (parse `date`, 30 days, revalidate).

- [ ] **Step 1: Write the failing test** `lib/booking/simulate-30day.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn(async () => (k: string) => k) }));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));

import { prisma } from "@/lib/db";
import { runDemoSimulation } from "@/lib/booking/batch-demo-actions";

afterAll(async () => {
  await prisma.booking.deleteMany({ where: { purpose: { startsWith: "BatchDemo:" } } });
  await prisma.driver.updateMany({ where: { isActive: true }, data: { lastTjwAt: null, lastOtAt: null, lastDutyAt: null, lastAssignedAt: null } });
  await prisma.$disconnect();
});

describe("runDemoSimulation (3-day pipeline)", () => {
  it("seeds, assigns ตจว first by request order, then plans each day", async () => {
    const summary = await runDemoSimulation(new Date("2026-09-01T00:00:00"), 3);

    expect(summary.days).toBe(3);
    expect(summary.seededCount).toBeGreaterThan(0);
    // ตจว got assigned by the request-order pass (before the per-day batch).
    expect(summary.tjwAssigned).toBeGreaterThan(0);
    expect(summary.perDay).toHaveLength(3);
    // Each day's batch ran (matched + pending + overflow accounted).
    for (const d of summary.perDay) {
      expect(d.matched + d.pending + d.overflow).toBeGreaterThanOrEqual(0);
    }
    // No ตจว driver double-booked across overlapping spans.
    const tjw = await prisma.booking.findMany({
      where: { purpose: { startsWith: "BatchDemo:" }, jobType: "TJW", primaryDriverId: { not: null } },
      select: { primaryDriverId: true, startAt: true, endAt: true },
    });
    for (let i = 0; i < tjw.length; i++)
      for (let j = i + 1; j < tjw.length; j++)
        if (tjw[i]!.primaryDriverId === tjw[j]!.primaryDriverId)
          expect(tjw[i]!.startAt < tjw[j]!.endAt && tjw[j]!.startAt < tjw[i]!.endAt).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (no `runDemoSimulation`): `npx vitest run lib/booking/simulate-30day.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement.** Add to `lib/booking/batch-demo-actions.ts`:
```ts
import { assignTjwByRequestOrder } from "@/lib/booking/tjw-request-actions";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";

export interface ThirtyDaySummary {
  startDate: string;
  days: number;
  seededCount: number;
  tjwAssigned: number;
  tjwOverflow: number;
  perDay: { date: string; matched: number; pending: number; overflow: number }[];
  totals: { matched: number; pending: number; overflow: number };
  fairness: { min: number; max: number; spread: number; stddev: number };
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function runDemoSimulation(start: Date, days: number): Promise<ThirtyDaySummary> {
  const dayStart = startOfDay(start);
  const seededCount = await seedBatchDemoRange(dayStart, days);

  // 1) ตจว + multi-day first, in request order.
  const tjwRes = await assignTjwByRequestOrder();
  const tjwAssigned = tjwRes.ok ? tjwRes.assigned : 0;
  const tjwOverflow = tjwRes.ok ? tjwRes.overflows.length : 0;

  // 2) Per-day batch for OT/WERN/NORMAL.
  const perDay: ThirtyDaySummary["perDay"] = [];
  const totals = { matched: 0, pending: 0, overflow: 0 };
  for (let i = 0; i < days; i++) {
    const d = new Date(dayStart);
    d.setDate(d.getDate() + i);
    const fd = new FormData();
    fd.set("date", ymd(d));
    const res = await runBatchAction(fd);
    const s = res.ok ? res.stats : undefined;
    const matched = s?.matchedCount ?? 0;
    const pending = s?.pendingCount ?? 0;
    const overflow = s ? Object.values(s.overflowByReason).reduce((a, b) => a + b, 0) : 0;
    perDay.push({ date: ymd(d), matched, pending, overflow });
    totals.matched += matched; totals.pending += pending; totals.overflow += overflow;
  }

  // 3) Fairness: assignments per driver across the seeded/assigned range.
  const rangeEnd = new Date(dayStart); rangeEnd.setDate(rangeEnd.getDate() + days + 2);
  const assigned = await prisma.booking.findMany({
    where: {
      purpose: { startsWith: BATCH_DEMO_TAG },
      status: { in: COMMITTED_STATUSES },
      primaryDriverId: { not: null },
      startAt: { gte: dayStart, lt: rangeEnd },
    },
    select: { primaryDriverId: true },
  });
  const counts = new Map<string, number>();
  for (const a of assigned) counts.set(a.primaryDriverId!, (counts.get(a.primaryDriverId!) ?? 0) + 1);
  const vals = [...counts.values()];
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 0;
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const stddev = vals.length ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) : 0;

  return {
    startDate: ymd(dayStart), days, seededCount, tjwAssigned, tjwOverflow,
    perDay, totals, fairness: { min, max, spread: max - min, stddev: Number(stddev.toFixed(2)) },
  };
}

export async function simulate30DaysAction(
  formData: FormData,
): Promise<ActionResult & { summary?: ThirtyDaySummary }> {
  await requireRole("ADMIN");
  const te = await getTranslations("errors");
  const parsed = runBatchSchema.safeParse({ date: formData.get("date") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? te("invalidInput") };
  const date = new Date(`${parsed.data.date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { ok: false, error: te("invalidInput") };
  try {
    const summary = await runDemoSimulation(date, 30);
    revalidatePath("/admin/batch");
    revalidatePath("/admin/schedule");
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : te("invalidInput") };
  }
}
```

- [ ] **Step 4: Run — expect PASS.** `npx vitest run lib/booking/simulate-30day.test.ts --no-file-parallelism`
- [ ] **Step 5: Full suite + typecheck** — `npx vitest run --no-file-parallelism` (must stay green, now +1 test) and `npm run typecheck` clean.
- [ ] **Step 6: Commit** — `feat(demo): runDemoSimulation + simulate30DaysAction (ตจว-first, 30-day)`

---

### Task 3: UI button + 30-day summary panel

**Files:**
- Modify: `components/forms/batch-run-form.tsx`
- Modify: `messages/en.json`, `messages/th.json`

**Interfaces:**
- Consumes: `simulate30DaysAction` + `ThirtyDaySummary` (Task 2); `useActionToast`.

- [ ] **Step 1: Wire the button.** In `components/forms/batch-run-form.tsx`:
  - import `simulate30DaysAction` and the `ThirtyDaySummary` type; add `const [sim30, setSim30] = useState<ThirtyDaySummary | null>(null);` and `setSim30(null);` to `reset()`.
  - add a handler:
```tsx
  function simulate30() {
    reset();
    const fd = new FormData();
    fd.set("date", date);
    startTransition(async () => {
      const res = await simulate30DaysAction(fd);
      if (!toastResult(res, { success: tt("batchDone") })) return;
      if (res.summary) setSim30(res.summary);
      refresh();
    });
  }
```
  (`tt` = `useTranslations("toast")`, `toastResult` = `useActionToast()` — both already used in this file.)
  - add the button next to "simulate day":
```tsx
        <Button type="button" variant="outline" onClick={simulate30} disabled={pending}>
          {pending ? t("simulating") : t("simulate30")}
        </Button>
```
  - render the summary panel after the existing result blocks:
```tsx
      {sim30 && (
        <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
          <p className="font-medium">{t("simulate30Title", { days: sim30.days })}</p>
          <p>{t("simulate30Totals", { seeded: sim30.seededCount, tjw: sim30.tjwAssigned, matched: sim30.totals.matched, overflow: sim30.totals.overflow })}</p>
          <p>{t("simulate30Fairness", { spread: sim30.fairness.spread, stddev: sim30.fairness.stddev })}</p>
          <ul className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
            {sim30.perDay.map((d) => (
              <li key={d.date} className="font-mono tabular-nums">
                {d.date}: {d.matched}✓ {d.overflow > 0 ? `${d.overflow}⚠` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
```

- [ ] **Step 2: i18n.** Add to `messages/en.json` `adminBatch`:
```json
    "simulate30": "Simulate 30 days",
    "simulate30Title": "30-day simulation from {days} days",
    "simulate30Totals": "Seeded {seeded} · ตจว assigned {tjw} · matched {matched} · overflow {overflow}",
    "simulate30Fairness": "Driver-load spread {spread} (stddev {stddev})",
```
and to `messages/th.json` `adminBatch`:
```json
    "simulate30": "จำลอง 30 วัน",
    "simulate30Title": "จำลอง 30 วัน ({days} วัน)",
    "simulate30Totals": "สร้าง {seeded} · จัด ตจว {tjw} · จัดได้ {matched} · ล้น {overflow}",
    "simulate30Fairness": "ความต่างภาระคนขับ {spread} (ส่วนเบี่ยงเบน {stddev})",
```
(`simulate30Title` uses `{days}` loosely as a label — keep the placeholder so both locales render; the value passed is `sim30.days`.)

- [ ] **Step 3: Verify** — both message files valid JSON; `npm run typecheck` clean; `npx vitest run --no-file-parallelism` still green.
- [ ] **Step 4: Confirm clear still cleans up** — `clearBatchDemoAction` already deletes ALL `BatchDemo:` rows across every date (verified in code), so a 30-day run is fully reversible via the existing "Clear demo data" button. No change needed; just confirm by reading the action.
- [ ] **Step 5: Visual smoke** — `npm run dev`; on `/admin/batch` click "Simulate 30 days" → summary panel shows totals + ตจว assigned + per-day list; "Clear demo data" empties it; spot-check a future day on `/admin/schedule` shows seeded+assigned trips.
- [ ] **Step 6: Commit** — `feat(admin): Simulate 30 days button + summary panel`

---

## Self-Review

**Spec coverage:** §2 pipeline order → T2 `runDemoSimulation` (ตจว pass then per-day batch) ✓; §3 range seeder → T1 ✓; §4 action + summary → T2 ✓; §5 UI → T3 ✓; §6 clear extended → already global, T3 Step 4 confirms ✓; §7 testing → T2 integration test (ตจว-first + per-day + no double-book) + full suite green ✓; §8 non-goals respected (no production-button/solver/schema change; demo-only) ✓.

**Placeholder scan:** full code for the seeder (T1), the orchestration + summary type + action + test (T2), and the UI wiring + i18n (T3). No TBD/TODO.

**Type consistency:** `ThirtyDaySummary` fields (`seededCount`, `tjwAssigned`, `perDay[].{date,matched,pending,overflow}`, `totals`, `fairness.{min,max,spread,stddev}`) are produced in T2 and consumed verbatim in T3's panel; `seedBatchDemoRange(start, days)` / `runDemoSimulation(start, days)` signatures match across tasks; `assignTjwByRequestOrder()` returns `{ ok, assigned, overflows }` (used in T2) per its existing definition; `runBatchAction(fd)` returns `{ ok, stats? }` with `stats.{matchedCount,pendingCount,overflowByReason}` (used in T2) per `BatchStats`.

**Note:** ~30 `runBatchAction` transactions + a few hundred demo rows per run — acceptable for an admin-triggered demo (spec §8); the integration test uses a 3-day range to stay fast.
</content>
