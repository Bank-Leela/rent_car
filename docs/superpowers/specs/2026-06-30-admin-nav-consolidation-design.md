# Admin navigation consolidation — design

**Date:** 2026-06-30
**Status:** approved (brainstorm), pending implementation plan

## Context

The admin top nav has grown to **11 items** (`app/(admin)/layout.tsx:15–27`):
Queue, Calendar, Dashboard, Feedback, Schedule, Simulate, Batch, Users, Drivers,
My decisions, Profile — plus the bell, theme toggle, language switcher, and avatar.
On a 13" screen the bar is visually crowded (see the 2026-06-30 screenshot) and the
flat list hides the natural grouping of the work.

Goal: reduce the top-level count without losing any functionality or moving any URLs.

## Goals

- Collapse 11 flat nav items into **5 functional sections** + the avatar menu.
- Group each section's pages behind a **secondary tab strip**.
- Keep every existing route, page, and server action **unchanged** (no merges, no
  redirects) — the change is nav chrome only, so pages stay independently testable.

## Non-goals

- No route renaming (we are NOT moving to `/admin/scheduling/board` etc.).
- No page merging into combined screens.
- No changes to any page's data fetching, server actions, or business logic.
- No mobile drawer redesign (out of scope; the 5-item bar already fits far better
  than 11 — a responsive pass can follow later).

## Current state

Flat nav, ADMIN-gated, built in `app/(admin)/layout.tsx`. Routes:

```
/admin              Queue (pending approvals; also the bell target)
/admin/[id]         Booking detail (approve/deny)        ← belongs to Requests
/admin/decisions    My approve/deny audit history
/admin/calendar     Month/day calendar
/admin/dashboard    KPI dashboard
/admin/evaluations  Driver star feedback + per-driver drill-in
/admin/schedule     Scheduler board (daily dispatch)
/admin/batch        Daily batch + TJW-by-request-order console
/admin/simulate     Placement simulator
/admin/users        Account management (create/reset/disable)
/admin/drivers      Driver roster + per-driver edit
/admin/fleet        Vehicle editor  ← exists but NOT linked from the nav today
/admin/profile      Admin signature image + approval delegation
```

`/admin/profile` is approver config (signature + `delegatedTo`), distinct from the
header avatar's `/account` (general account settings). `/admin/fleet` is currently
unreachable from the nav.

## Design

### Section structure (5 primary items)

| Section | Default route | Tabs (existing routes, unchanged) |
|---|---|---|
| **Requests** | `/admin` | Pending `/admin` · History `/admin/decisions` |
| **Scheduling** | `/admin/schedule` | Board `/admin/schedule` · Batch `/admin/batch` · Simulate `/admin/simulate` |
| **Calendar** | `/admin/calendar` | _(standalone — no secondary tabs)_ |
| **People** | `/admin/users` | Accounts `/admin/users` · Drivers `/admin/drivers` · Vehicles `/admin/fleet` |
| **Insights** | `/admin/dashboard` | Dashboard `/admin/dashboard` · Feedback `/admin/evaluations` |

A primary item links to its **default route** and renders as **active** when the
current path belongs to that section. When a section has >1 tab, a **secondary tab
strip** appears below the primary bar showing that section's tabs; the active tab is
the exact current route.

`/admin/profile` leaves the nav entirely → it becomes an admin-only item in the
header **avatar dropdown** (`components/profile-menu.tsx`), beneath Account / Change
Password, labelled "Signature & delegation".

### Active-section matching (explicit, not prefix)

`startsWith('/admin/')` is unsafe — it would make Requests swallow `/admin/schedule`.
Each section declares an explicit `match` list of routes/patterns:

```
Requests:   ['/admin', '/admin/decisions', '/admin/:id']   // :id = booking detail
Scheduling: ['/admin/schedule', '/admin/batch', '/admin/simulate']
Calendar:   ['/admin/calendar']                              // + /admin/calendar/day/:date
People:     ['/admin/users', '/admin/drivers', '/admin/fleet'] // + /admin/drivers/:id
Insights:   ['/admin/dashboard', '/admin/evaluations']         // + /admin/evaluations/:driverId
```

Matching rule: a path matches a section if it **equals** a listed route or is a
**child segment** of one (`path === r || path.startsWith(r + '/')`), evaluated against
the section's own listed routes only. The booking-detail catch-all `/admin/:id`
(a cuid, never a known sub-route) resolves to **Requests** as the fallback: if no
section's explicit routes match and the path is `/admin/<single-segment>`, default to
Requests. This keeps the approve/deny detail page under the Requests section.

### Components

- **`app/(admin)/layout.tsx`** — replace the flat `nav` array with a `SECTIONS`
  config (`{ key, label, href, match: string[], tabs?: {label, href}[] }`). Pass it to
  the nav component. The bell keeps targeting `/admin`.
- **`components/admin/admin-nav.tsx`** (NEW, client) — reads `usePathname()`, renders:
  (1) the 5 primary links with active styling; (2) the secondary tab strip for the
  active section when it has tabs. One focused unit: input = sections config +
  pathname, output = nav markup. No data fetching.
- **`components/profile-menu.tsx`** — add an admin-only `DropdownMenuItem`
  "Signature & delegation" → `/admin/profile` (gated by a new `isAdmin` prop the
  server layout already knows). Uses `onClick` (Base UI), consistent with the others.

### i18n

Add 4 section labels to the `nav` namespace in `messages/{en,th}.json`:
`requests`, `scheduling`, `people`, `insights`. Reuse the existing labels
(`queue`, `schedule`, `batch`, `simulate`, `users`, `drivers`, `dashboard`,
`evaluations`, `calendar`, `decisions`, `profile`) for tab labels. Add one label for
the avatar item, e.g. `profileMenu.signature`. Thai: Requests = คำขอ, Scheduling =
การจัดรถ, People = บุคลากร, Insights = ภาพรวม (final wording confirmed at
implementation; Thai vocab corrections per memory).

## Edge cases

- **Booking detail `/admin/[id]`** → Requests (fallback rule above). Verify a cuid id
  never collides with a known sub-route name (it can't — they're fixed words).
- **Nested routes** (`/admin/calendar/day/[date]`, `/admin/drivers/[id]`,
  `/admin/evaluations/[driverId]`) highlight their parent section + tab via the
  child-segment rule.
- **Vehicles tab** surfaces `/admin/fleet`, previously unreachable — confirm the page
  renders standalone (it does: `FleetEditor`).
- **Active styling** must not double-mark (a path matches exactly one section by
  construction; tabs match exactly one route).

## Testing

- **Unit** (`components/admin/admin-nav.test.ts`): a pure `resolveActiveSection(pathname,
  SECTIONS)` helper returns the right section + active tab for: each default route,
  each nested route, the booking-detail fallback, and an unknown `/admin/foo`.
  Extract the matching logic into a pure function so it is testable without rendering.
- **Typecheck**: `npx tsc --noEmit`.
- **Manual** (`npm run dev`, admin login): click through all 5 sections + every tab,
  confirm active highlighting, confirm Profile reachable from the avatar menu,
  confirm bell still lands on `/admin`.

## Rollout

Single PR / commit set. Pure-additive nav refactor; no migration, no data change.
Reversible by restoring the flat `nav` array. Follow-up (separate): refresh
`docs/PROJECT-OVERVIEW.md` §nav/routes to match.
