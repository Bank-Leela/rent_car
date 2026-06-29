# Design — Quality-of-life pass

**Date:** 2026-06-29
**Branch:** `feat/qol-updates` (off `feat/new-system`)
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** UI-only polish. **No scheduling / booking / auth logic is touched**, so the
332-test suite + `simulate-cr07` stay green as a regression guard throughout.

Four independent improvements, all grounded in gaps found by surveying the app:

| # | Item | Gap found |
|---|------|-----------|
| 1 | Toast feedback | `sonner` installed but `<Toaster>` never mounted; `toast()` called **0×** |
| 2 | Loading skeletons | only route-**group** generics exist; heavy routes have no tailored skeleton |
| 3 | List search | `users`, `history`, `fleet`, `evaluations` lists have no filter (`decisions` does) |
| 4 | Empty states | `<EmptyState>` exists but several lists still render blank/terse |

---

## 1. Toast feedback

- **Mount once:** add `<Toaster richColors closeButton />` to `app/layout.tsx` (inside `<body>`).
- **Helper:** `components/hooks/use-action-toast.ts` — `useActionToast()` returns a `toastResult(res, { success })` that fires `toast.success(success)` when `res.ok`, else `toast.error(res.error)`. Forms already track `res.ok`/`res.error`, so this is a one-line add per call site.
- **Call sites (main flows only — not every minor action):**
  - Booking submit (`booking-form.tsx`), template save/delete.
  - Approve / deny (`approve-form` + admin booking actions).
  - Batch run + the new **Assign ตจว** button (`batch-run-form.tsx`).
  - Assign / unassign / reassign (scheduler board).
  - Driver claim / decline.
- **Additive:** existing inline error text stays; toast is extra confirmation. Success messages come from a new `messages` `toast.*` namespace (en + th).

## 2. Loading skeletons

Per-route `loading.tsx` for the heavy routes, each a skeleton matching the page shape, built from the existing `components/ui/skeleton.tsx`:

- `/admin/schedule` — board skeleton (car-row stripes + time-axis).
- `/admin/batch`, `/admin/calendar`, `/admin/users`, `/admin/fleet`.
- `/requester/upcoming`, `/requester/history`, `/driver/board`.

Route-group `loading.tsx` (`(admin)`, `(driver)`, `(requester)`) remain as the fallback for everything else. Pure UX — no data/logic.

## 3. List search

- **Component:** `components/list-search.tsx` — a client `<ListSearch items rows searchKeys placeholder>` (or a thin `useListFilter` hook) that renders a search `<input>` and instant-filters rows client-side by the given keys (case-insensitive, Thai-friendly `toLowerCase`).
- **Apply to:** `users`, `history`, `fleet`, `evaluations`. Each page's row list becomes (or is wrapped by) a small client component fed the server data.
- **Empty result** reuses the EmptyState ("No matches").
- This is the one item with real logic → gets a unit test for the filter.

## 4. Empty states

- Reuse `components/empty-state.tsx`. Audit the requester / driver / admin lists; where a list renders empty, show `<EmptyState>` with an icon, a short message, and a relevant action (e.g. requester upcoming → "New booking", driver board → "No trips today").
- Cosmetic only.

---

## Testing

- `npx tsc --noEmit` clean.
- **Full suite + simulate stay green** (no logic touched) — the regression guard.
- New unit test: the `<ListSearch>` / `useListFilter` filter (case-insensitivity, multi-key, empty query returns all).
- Visual smoke on the dev server: a toast fires on an action, one skeleton shows on navigation, a search box filters, an empty list shows the card.

## Non-goals

- No server-side search / pagination (client filter only; lists are small).
- No new toast on every minor/admin action — main flows only.
- No redesign of list layouts beyond adding search + empty state.
- No scheduling / booking / schema changes.

## Affected files (anticipated)

- `app/layout.tsx` (Toaster) · `components/hooks/use-action-toast.ts` (new).
- Form/action call sites: `booking-form.tsx`, `approve-form.tsx`, `batch-run-form.tsx`, scheduler board components, driver claim/decline forms.
- New `loading.tsx` under the 8 heavy routes.
- `components/list-search.tsx` (new) + `list-search.test.ts` (new); `users`/`history`/`fleet`/`evaluations` page row lists.
- EmptyState drop-ins across requester/driver/admin lists.
- `messages/{en,th}.json` — `toast.*` + `listSearch.*` keys.

## Self-review notes

- Reuses existing primitives (`Skeleton`, `EmptyState`, `sonner`, the `res.ok/res.error` ActionResult contract) — the only genuinely new code is the toast helper and the list filter.
- Each item is independent and shippable on its own; safe to land incrementally.
</content>
