# rent_car — Project Overview

A Thai-language **vehicle booking, approval, and dispatch** system
for a Chulalongkorn University medical faculty. Staff request a faculty vehicle;
the fleet admin (P'Top) approves it and assigns a driver + car; the driver
runs the trip; the requester evaluates it. The hard part — and the bulk of the
domain logic — is **fair, rule-respecting driver/vehicle assignment**.

This is the high-level map. For depth, follow the links in each section and the
[Document index](#document-index) at the end.

---

## 1. Who uses it (roles)

`Role` enum — a user can hold more than one (`UserRole` join):

| Role | Does |
|------|------|
| **REQUESTER** | Submits booking requests, tracks their history, evaluates completed trips. |
| **ADMIN** ("P'Top") | Approves/denies pending requests (inline Approve/Deny per card, triage badges + SLA banner, `/admin/decisions` audit), runs the daily batch, hand-assigns/overrides on the board, manages users, cars↔drivers, duty roster, reports. |
| **DRIVER** | Passive, station-only: the shared garage kiosk shows the day's assignments (read-only) and records trip start + end (mileage/fuel/toll/parking). No individual logins, no claim/release. |

Sign-in is **admin-provisioned username/password** (Auth.js v5 Credentials, not
OAuth). `mustChangePassword` forces a reset on first login; usernames are
changeable once. Dev mode has role "preview-as" buttons.

---

## 2. Core domain concepts

- **car = driver.** Every active vehicle has exactly one assigned driver
  (`Vehicle.assignedDriverId`). Picking the driver *is* picking the car — there is
  no separate vehicle search. A driver with no car can't be dispatched.
- **Job types** (`JobType`, auto-classified from the trip): **TJW** (out-of-province
  + overnight, long-haul), **OT** (overtime / out-of-hours / overnight-in-area),
  **WERN** (on-call duty, from the `OnCallShift` roster — never auto-classified),
  **NORMAL** (everything else), plus **SMUS** (external charter, หลักสูตรนิสิตแพทย์ — the
  requester books outside buses/vans themselves, so it bypasses internal vehicle and
  driver allocation entirely). SMUS is **live**: it was retired in `9ccc55a` and
  restored, and `docs/scheduling-algorithm.md` §2 is the authority. It is never
  produced by the classifier — the form sets it.
- **Long trip** = `estimatedDistance > 400 km` → needs a relief **co-driver**.
- **Fairness** is duration-weighted over a rolling 30-day window
  (`earningsScore`); rotation timestamps per category break ties.

---

## 3. Booking lifecycle

```
PENDING_APPROVAL → AWAITING_DOCUMENT → APPROVED → ASSIGNED → COMPLETED
        │                                             │
        ├→ DENIED                                     └→ (drag/✕) back to APPROVED
        ├→ CANCELLED                                        (unassigned)
        ├→ WAITLIST    (submit-time overflow)
        └→ OUTSOURCED  (fleet full + requester accepted an outside rental)
```

**AWAITING_DOCUMENT is the stage that trips people up.** Approving no longer
hands out a car: the booking waits there until the signed official form is back
and an ADMIN confirms it (`approveDocumentAction`) — and confirming it is what
runs จัด. DRAFT exists in the enum but is never written.

1. **Request** (`requester/new`) — form (react-hook-form + zod), lead-time +
   work-hours + buffer rules, optional recurrence. Out-of-province is an explicit
   flag, not inferred.
2. **Approval** (ADMIN) — approve/deny with a comment; emails the
   requester. The `/admin` queue carries triage badges + an SLA banner
   (`lib/booking/triage.ts`); each pending card has inline Approve/Deny
   (`components/forms/approver-queue-actions.tsx` — historical filename)
   with canned deny-reason chips (`lib/booking/deny-presets.ts`), and the
   booking detail page adds a decision-context card (day load + free cars +
   risk flags). Admins get a personal audit at `/admin/decisions`.
3. **Assignment** (ADMIN) — three ways:
   - **Batch solver** (`/admin/batch` → Run Batch): solves the whole day at once.
   - **Single matcher** (board auto-assign / `/admin/[id]`): one booking.
   - **Manual** drag-drop on the **schedule board** (`/admin/schedule`).
4. **Dispatch** — the shared station kiosk shows the day's work at `/driver` and
   `/driver/schedule`, and the driver **starts** (start mileage) and **completes**
   (end mileage → distance) the trip. There is no claim step and no
   `/driver/board`: both went with the passive-driver change described in §1,
   which this section used to contradict.
   The requester gets a read-only confirmation of their assigned driver for
   today/tomorrow at `/requester/upcoming`.
5. **Evaluation** — requester rates the completed trip (`EvaluationRating`). A
   pending evaluation blocks the requester's next submission only while the
   `EVALUATION_GATE_ENABLED` kill switch (`lib/booking/rules.ts`) is `true`; it
   is `false` right now, so an unevaluated trip blocks nothing. Even with the
   switch back on, `createBookingAction` skips the gate for admin-on-behalf
   filings.

Every status transition writes an **`AuditLog`** row through one shared helper
(`lib/booking/audit.ts:logTransition`).

---

## 4. The scheduling subsystem (the core)

Full rules + source map: **[`docs/scheduling-algorithm.md`](./scheduling-algorithm.md)**.
Summary:

- **Category priority** TJW → OT → WERN → NORMAL (FCFS within each).
- **Eligibility** (`canChain`): no overlap; **≥ 2h gap** between every pair of a
  driver's trips; NORMAL capped at **one morning + one afternoon**; OT is exempt
  from the cap but not the gap; TJW locks the driver "away" for the trip span.
- **No-overlap rule:** no car may ever be double-booked — *not even the duty car*.
  A manual override (drag / assign-reco) may relax the 2h gap, **never** overlap.
- **Commitment visibility:** a trip claimed via the board is `status: APPROVED`
  with a driver; the solver counts those (`COMMITTED_STATUSES`) so a still-away
  driver isn't re-assigned or treated as idle.
- **Leftovers** the solver can't place get a **placement recommendation** (the
  fairest *legal* car, then a duty reclaim) on the batch overflow list, with
  one-click assign.
- **Board** (`driver-rounds-board.tsx`): one row per driver (car = driver), that
  day's rounds as chips reading `start–end · place`, job-type colours with a
  legend, the เวร driver's row edge-striped, multi-day trips shown on every day
  they span as depart / away / return. Admin gets a per-round move control; the
  kiosk is read-only. Bulk assignment is `/admin/batch`; an overlap among
  already-assigned trips is refused at the action rather than drawn, and stays
  manual. (An automatic loser-reassignment pass with WERN/duty pinning —
  `conflict-resolve.ts` / `resolveScheduleConflictsAction` — was specced but is
  **not implemented**; those symbols exist in no source file. See
  `scheduling-algorithm.md` §8.)

Measurement instrument: the pure **simulation harness** (`simulation.ts`) backs
the property-fuzz tests and `scripts/simulate-cr07.ts` scenarios.

---

## 5. Supporting features

- **Calendar** — month grid + per-day agenda/timeline (admin + driver), density
  tint, conflict markers, vehicle filter; multi-day trips span every day.
- **Reporting** — admin dashboard with monthly KPI buckets (recharts), department
  usage, cancellations; CSV export (`/api/reports/csv/[kind]`).
- **PDF** — request document via `@react-pdf/renderer` (`/api/files/booking-pdf/[id]`).
- **Email** — Resend, with a console fallback when no API key (Thai templates).
- **LINE** — driver-only push (`lib/line`); code paths exist, channel **pending**.
- **i18n** — next-intl with a single locale: Thai (`messages/th.json`), plus
  Buddhist-era dates. English was removed 2026-08-05 (`i18n/config.ts`) — the
  app serves one audience and a parallel string set doubled the review surface
  of every screen. Keys still resolve at RUNTIME, so a missing one is a runtime
  failure no build can catch; `tests/i18n-keys.test.ts` is the guard.
- **Error handling** — per-route-group `error.tsx` + `not-found.tsx`, a root
  `global-error.tsx`; themed + translated.

---

## 6. Architecture & stack

- **Next.js 16** (App Router, React Server Components, Turbopack). *Heed
  `node_modules/next/dist/docs` — APIs differ from older Next.*
- **TypeScript**, **PostgreSQL 16** via **Prisma v5**.
- **Auth.js v5** (Credentials).
- **Tailwind v4** + **shadcn/ui** (@base-ui primitives), **react-hook-form** + **zod**.
- **date-fns**, **next-intl**, **recharts**, **@react-pdf/renderer**, **Resend**.

### Repo map

| Path | What |
|------|------|
| `app/(admin)/*` | ADMIN (P'Top): queue + approve/deny, calendar, dashboard, evaluations, booking detail, schedule board, batch, fleet, users, drivers, decisions, simulate, profile. |
| `app/(driver)/*` | Shared station kiosk (read-only): schedule board, calendar, trip detail + record start/end. |
| `app/(requester)/*` | Requester: new request, upcoming (confirmed driver for today/tomorrow), history, detail. |
| `app/(login\|forgot\|reset\|account)` | Auth surfaces. |
| `app/api/*` | NextAuth, dev sign-in, booking PDF, reports CSV, LINE webhook. |
| `lib/booking/*` (~34 files) | Scheduling/assignment domain — solver, matcher, rules, recommendations, audit, fairness, day-window, TJW request-order solver, plus queue triage and deny presets. |
| `lib/{auth,email,line,pdf,reporting}/*` | Auth helpers, email, LINE, PDF, reporting. |
| `components/*` | UI — forms, the rounds board (`driver/driver-rounds-board.tsx`), shared UI. |
| `prisma/` | Schema (18 models, 12 enums), 17 migrations, seed. |
| `scripts/` | One-off dev tools — simulation, demo seeding, data maintenance; indexed in [`scripts/README.md`](../scripts/README.md). |

### Key data model (18 models)

`User` / `UserRole` / `Account` / `Session` / `VerificationToken` / `PasswordResetToken` (auth) ·
`Department` · `Vehicle` · `Driver` (+ `OnCallShift` duty roster) · `Booking`
(+ `RecurrenceRule`) · `BookingClaim` · `Approval` · `Trip` · `Cancellation` ·
`Evaluation` · `AuditLog`.

---

## 7. Running & verifying

Setup and first run: **[`README.md`](../README.md)** — the single setup
document. Server install: **[`docs/deployment.md`](deployment.md)**.

```bash
npm run dev          # dev server (localhost:3000)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest — the whole suite (solver invariants + fuzz)
npx tsx scripts/simulate-cr07.ts --scenario=<mixed|tjw|chain|tight|reclaim|…>
```

**Scheduling changes must** pass `npm test` + the simulate-cr07 scenarios
(rule-check counters stay 0) — see **[`AGENTS.md`](../AGENTS.md)**.

---

## 8. Status & operating notes

- All five phases of the original implementation plan are shipped.
- **Production** DB + hosting are handled by **Chula IT** (local dev uses Homebrew
  Postgres 16). Don't migrate to Neon/Supabase/etc.
- **LINE** notifications are scoped **driver-only** and await a live channel.
- The `BatchDemo:` data is dev scaffolding — clear + reseed via
  `scripts/seed-batch-demo.ts` or the batch page's demo controls.

---

## Document index

| Doc | Purpose |
|-----|---------|
| **This file** | High-level project overview. |
| [`README.md`](../README.md) | **Start here.** First run on your own machine, first login, smoke test. |
| [`deployment.md`](deployment.md) | The server runbook: nginx, systemd, TLS, backups, the nightly จัดรอบ timer. |
| [`AGENTS.md`](../AGENTS.md) | Agent rules: Next-16 caveat, scheduling source-of-truth + verification. |
| [`HANDOFF.md`](../HANDOFF.md) | What a fresh session needs first: invariants, open items, conventions. |
| [`docs/session-log.md`](session-log.md) | The chronological record — read for the history of one decision, not to start work. |
| [`docs/scheduling-algorithm.md`](./scheduling-algorithm.md) | The assignment rules, solver/matcher, source map. |
| `docs/superpowers/specs/*`, `plans/*` | Point-in-time design/decision records. |
