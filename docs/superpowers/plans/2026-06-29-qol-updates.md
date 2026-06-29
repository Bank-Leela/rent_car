# Quality-of-life Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four UI-only quality-of-life improvements — toast feedback, loading skeletons, list search, friendly empty states — with no scheduling/booking logic touched.

**Architecture:** Reuse existing primitives (`components/ui/sonner.tsx`, `components/ui/skeleton.tsx`, `components/empty-state.tsx`, the `ActionResult` `{ ok, error }` contract). Only genuinely new code: a `useActionToast` helper and a `ListSearch` client filter (the latter unit-tested).

**Tech Stack:** Next.js (app router), React client components, sonner, next-intl, vitest.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-29-qol-updates-design.md`.
- **UI-only — no scheduling / booking / schema / auth changes.** The 332-test suite + `simulate-cr07` must stay green unchanged (regression guard).
- Toast on **main flows only** (submit, approve/deny, batch run + Assign ตจว, assign/unassign/reassign, claim/decline) — not every minor action.
- Search is **client-side** (lists are small); no server pagination.
- All copy goes through next-intl with **en + th parity** (no hardcoded user-facing strings).
- Verify after `.ts`/`.tsx`: `npx tsc --noEmit`; tests `npx vitest run --no-file-parallelism`.

---

### Task 1: Toast infrastructure (mount + helper + i18n)

**Files:**
- Modify: `app/layout.tsx`
- Create: `components/hooks/use-action-toast.ts`
- Modify: `messages/en.json`, `messages/th.json`

**Interfaces:**
- Produces: `useActionToast(): { toastResult: (res: { ok: boolean; error?: string }, opts: { success: string }) => boolean }` — fires `toast.success(success)` on ok, else `toast.error(res.error ?? generic)`; returns `res.ok`.

- [ ] **Step 1: Mount the Toaster.** In `app/layout.tsx`, import `import { Toaster } from "@/components/ui/sonner";` and render it inside the providers, right after `{children}`:
```tsx
          <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
            <Toaster richColors closeButton />
          </NextIntlClientProvider>
```

- [ ] **Step 2: Add the helper** `components/hooks/use-action-toast.ts`:
```ts
"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

// Fire a success/error toast from an ActionResult ({ ok, error }). Returns res.ok
// so call sites can branch: `if (toastResult(res, { success: t("saved") })) router.refresh()`.
export function useActionToast() {
  const t = useTranslations("toast");
  function toastResult(res: { ok: boolean; error?: string }, opts: { success: string }) {
    if (res.ok) toast.success(opts.success);
    else toast.error(res.error ?? t("genericError"));
    return res.ok;
  }
  return { toastResult };
}
```

- [ ] **Step 3: Add i18n keys.** In `messages/en.json` add a top-level `"toast"` namespace:
```json
  "toast": {
    "genericError": "Something went wrong. Please try again.",
    "bookingSubmitted": "Booking submitted.",
    "bookingApproved": "Booking approved.",
    "bookingDenied": "Booking denied.",
    "batchDone": "Batch complete.",
    "tjwAssigned": "TJW assigned by request order.",
    "assigned": "Assigned.",
    "unassigned": "Returned to the queue.",
    "claimed": "Trip claimed.",
    "declined": "Trip declined.",
    "templateSaved": "Template saved.",
    "templateDeleted": "Template deleted."
  },
```
In `messages/th.json` add the same keys with Thai values:
```json
  "toast": {
    "genericError": "เกิดข้อผิดพลาด กรุณาลองใหม่",
    "bookingSubmitted": "ส่งคำขอแล้ว",
    "bookingApproved": "อนุมัติแล้ว",
    "bookingDenied": "ปฏิเสธแล้ว",
    "batchDone": "จัดรอบเสร็จแล้ว",
    "tjwAssigned": "จัด ตจว ตามลำดับการจองแล้ว",
    "assigned": "จัดรถแล้ว",
    "unassigned": "ส่งกลับคิวแล้ว",
    "claimed": "รับงานแล้ว",
    "declined": "ปฏิเสธงานแล้ว",
    "templateSaved": "บันทึกเทมเพลตแล้ว",
    "templateDeleted": "ลบเทมเพลตแล้ว"
  },
```

- [ ] **Step 4: Verify.** `node -e "JSON.parse(require('fs').readFileSync('messages/en.json'));JSON.parse(require('fs').readFileSync('messages/th.json'));console.log('ok')"` → `ok`; `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** — `feat(qol): mount Toaster + useActionToast helper + toast i18n`

---

### Task 2: Wire toasts into the main flows

**Files (modify):** `components/forms/batch-run-form.tsx`, `components/forms/booking-form.tsx`, `components/forms/approve-form.tsx`, the scheduler board assign/unassign handler component, the driver claim/decline form(s).

**Interfaces:**
- Consumes: `useActionToast` (Task 1).

- [ ] **Step 1: Batch console (clearest example).** In `components/forms/batch-run-form.tsx`, add `const { toastResult } = useActionToast();` and at each action result, fire a toast. For the TJW button's `runTjw`:
```tsx
      const res = await assignTjwByRequestOrder();
      if (!toastResult(res, { success: t("tjwAssigned") })) return;
      setTjw({ assigned: res.assigned, overflows: res.overflows });
      refresh();
```
(`t` here is the existing `useTranslations("adminBatch")`; switch the success string to a `useTranslations("toast")` instance, e.g. `const tt = useTranslations("toast"); ... { success: tt("tjwAssigned") }`.) Do the same for `run()` (success `tt("batchDone")`) and `simulate()`.

- [ ] **Step 2: Booking form.** In `components/forms/booking-form.tsx`, where the submit action resolves (`res.ok`), call `toastResult(res, { success: tt("bookingSubmitted") })`; for template save/delete use `templateSaved`/`templateDeleted`. Keep the existing inline `setError`/`setTemplateMsg`.

- [ ] **Step 3: Approve/deny + assign/unassign + claim/decline.** In `approve-form.tsx` fire `bookingApproved`/`bookingDenied`; in the scheduler board's assign/unassign/reassign handlers fire `assigned`/`unassigned`; in the driver claim/decline forms fire `claimed`/`declined`. Each is the same one-liner at the existing result branch.

- [ ] **Step 4: Verify.** `npx tsc --noEmit` clean; `npx vitest run --no-file-parallelism` → still **332 passing** (no logic changed).
- [ ] **Step 5: Visual smoke.** With `npm run dev`, run the batch and confirm a success toast appears bottom-right; trigger an error (e.g. empty form) and confirm an error toast.
- [ ] **Step 6: Commit** — `feat(qol): success/error toasts on the main action flows`

---

### Task 3: ListSearch client filter + unit test

**Files:**
- Create: `components/list-search.tsx`
- Test: `components/list-search.test.ts`
- Modify: `messages/en.json`, `messages/th.json` (`listSearch` keys)

**Interfaces:**
- Produces:
  - `filterRows<T>(rows: T[], query: string, keys: (keyof T)[]): T[]` — pure; case-insensitive substring match on the stringified values of `keys`; empty/whitespace query returns all rows.
  - `<ListSearch items={...} keys={...} placeholder render={(filtered) => ReactNode} />` — client component rendering a search input + `render(filtered)`.

- [ ] **Step 1: Write the failing test** `components/list-search.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { filterRows } from "./list-search";

const rows = [
  { name: "สมชาย", reg: "1กก-1111" },
  { name: "Sunee", reg: "2ขข-2222" },
  { name: "ประเสริฐ", reg: "1กก-3333" },
];

describe("filterRows", () => {
  it("returns all rows for an empty/whitespace query", () => {
    expect(filterRows(rows, "", ["name"])).toHaveLength(3);
    expect(filterRows(rows, "   ", ["name"])).toHaveLength(3);
  });
  it("matches case-insensitively on a single key", () => {
    expect(filterRows(rows, "sun", ["name"])).toEqual([rows[1]]);
  });
  it("matches across multiple keys", () => {
    expect(filterRows(rows, "1กก", ["name", "reg"])).toHaveLength(2);
  });
  it("returns none when nothing matches", () => {
    expect(filterRows(rows, "zzz", ["name", "reg"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing): `npx vitest run components/list-search.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement** `components/list-search.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function filterRows<T>(rows: T[], query: string, keys: (keyof T)[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    keys.some((k) => String(row[k] ?? "").toLowerCase().includes(q)),
  );
}

export function ListSearch<T>({
  items,
  keys,
  placeholder,
  render,
}: {
  items: T[];
  keys: (keyof T)[];
  placeholder?: string;
  render: (filtered: T[]) => React.ReactNode;
}) {
  const t = useTranslations("listSearch");
  const [query, setQuery] = useState("");
  const filtered = filterRows(items, query, keys);
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? t("placeholder")}
          className="pl-9"
        />
      </div>
      {render(filtered)}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS.** `npx vitest run components/list-search.test.ts --no-file-parallelism`
- [ ] **Step 5: i18n.** Add `"listSearch": { "placeholder": "Search…", "noMatches": "No matches" }` to `messages/en.json` and `"listSearch": { "placeholder": "ค้นหา…", "noMatches": "ไม่พบรายการ" }` to `messages/th.json`.
- [ ] **Step 6: Verify** — `npm run typecheck` clean.
- [ ] **Step 7: Commit** — `feat(qol): ListSearch client filter + filterRows test`

---

### Task 4: Apply ListSearch to the four list pages

**Files (modify):** `app/(admin)/admin/users/page.tsx`, `app/(requester)/requester/history/page.tsx`, `app/(admin)/admin/fleet/page.tsx`, `app/(admin)/admin/evaluations/page.tsx`.

**Interfaces:**
- Consumes: `ListSearch` + `filterRows` (Task 3), `EmptyState` (for no-matches).

- [ ] **Step 1: Users page.** These are server components; extract the row list into a sibling client component (e.g. `components/admin/users-table-client.tsx`) that receives the already-fetched user array as a prop and wraps it in `<ListSearch items={users} keys={["name", "email"]} render={(rows) => /* the existing table body over rows */} />`. Show `<EmptyState>` (or `t("listSearch.noMatches")`) when `rows.length === 0`. The server page maps DB rows → a plain serializable array and renders the client table.

- [ ] **Step 2: Repeat for history, fleet, evaluations** — same pattern, `keys` per page: history `["destination", "purpose", "jobNumber"]`; fleet `["registrationNumber", "driverName"]`; evaluations `["jobNumber", "driverName"]`. (Use whatever fields each page already displays.)

- [ ] **Step 3: Verify** — `npm run typecheck` clean; `npx vitest run --no-file-parallelism` → 332 + the new filter test still green.
- [ ] **Step 4: Visual smoke** — `/admin/users` shows a search box; typing filters rows live; clearing restores all.
- [ ] **Step 5: Commit** — `feat(qol): live search on users / history / fleet / evaluations`

---

### Task 5: Loading skeletons for heavy routes

**Files (create):** `loading.tsx` under each of —
`app/(admin)/admin/schedule/`, `app/(admin)/admin/batch/`, `app/(admin)/admin/calendar/`, `app/(admin)/admin/users/`, `app/(admin)/admin/fleet/`, `app/(requester)/requester/upcoming/`, `app/(requester)/requester/history/`, `app/(driver)/driver/board/`.

**Interfaces:**
- Consumes: `Skeleton` from `@/components/ui/skeleton`.

- [ ] **Step 1: Board skeleton** `app/(admin)/admin/schedule/loading.tsx` (the most distinctive; others are simpler variants):
```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4 p-4" aria-busy aria-label="Loading schedule">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-10 w-32 shrink-0" />
            <Skeleton className="h-10 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: List skeleton** for the remaining 7 routes (a table-ish stack — adjust the header width per page):
```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-3 p-4" aria-busy aria-label="Loading">
      <Skeleton className="h-8 w-40" />
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify** — `npm run typecheck` clean.
- [ ] **Step 4: Visual smoke** — navigate to `/admin/schedule` (throttle network in devtools) and confirm the board skeleton flashes before data.
- [ ] **Step 5: Commit** — `feat(qol): tailored loading skeletons for 8 heavy routes`

---

### Task 6: Friendly empty states

**Files (modify):** the requester/driver/admin list pages whose empty branch is blank/terse — e.g. `app/(requester)/requester/upcoming/page.tsx`, `app/(requester)/requester/history/page.tsx`, `app/(driver)/driver/board/page.tsx`, plus any admin list with a bare "none" message.

**Interfaces:**
- Consumes: `EmptyState` (`{ icon, title, description?, action? }`), lucide icons.

- [ ] **Step 1: Requester upcoming.** Where the list is empty, render:
```tsx
import { CalendarPlus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
// ...
<EmptyState
  icon={CalendarPlus}
  title={t("emptyUpcomingTitle")}
  description={t("emptyUpcomingDesc")}
  action={<Button asChild><Link href="/requester/new">{t("newBooking")}</Link></Button>}
/>
```

- [ ] **Step 2: Repeat** for driver board ("No trips today") and the other blank lists, each with a fitting icon + message + (where useful) an action. Add the `empty*` keys to `messages/{en,th}.json` (en + th parity).
- [ ] **Step 3: Verify** — JSON valid; `npm run typecheck` clean.
- [ ] **Step 4: Visual smoke** — an empty list (e.g. a fresh requester) shows the card instead of blank.
- [ ] **Step 5: Commit** — `feat(qol): friendly empty states across the lists`

---

## Self-Review

**Spec coverage:** §1 toast → T1 (infra) + T2 (wiring) ✓; §2 skeletons → T5 ✓; §3 search → T3 (component+test) + T4 (apply) ✓; §4 empty states → T6 ✓; testing (filter unit test + suite-stays-green + visual smokes) present in each task ✓; non-goals respected (client-only search, main-flow toasts, no logic/schema change) ✓.

**Placeholder scan:** full code for the two new units (`useActionToast`, `ListSearch`/`filterRows`) + their tests, the layout edit, and sample skeleton/empty-state drop-ins. T2/T4/T6 repeat one concrete pattern across sibling files (each names its exact files + keys) rather than re-pasting near-identical blocks — acceptable since the pattern is shown once in full.

**Type consistency:** `useActionToast().toastResult(res, { success })`, `filterRows(rows, query, keys)`, and `<ListSearch items keys render>` are used identically across tasks; toast i18n namespace `toast.*`, search namespace `listSearch.*` consistent.

**Note:** Tasks are independent and individually shippable; order is convenience, not hard dependency (T2 needs T1; T4 needs T3 — the rest stand alone).
</content>
