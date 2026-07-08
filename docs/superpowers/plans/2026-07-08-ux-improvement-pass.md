# UX Improvement Pass (A–D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Steps use checkbox (`- [ ]`) syntax for tracking. Executed sequentially A→B→C→D, one commit set + verification per package.

**Goal:** Ship the four approved UX packages: requester visibility (A), P'Top queue speedups (B), kiosk glance-ability (C), roster & fleet alerts (D).

**Architecture:** Additive UI + a few server-action extensions. No scheduling-rule changes; all booking mutations reuse existing actions/helpers. Pure logic (roster alert windows) isolated in a unit-tested helper module.

**Tech Stack:** Next.js 16 App Router (RSC + server actions), Prisma, next-intl, sonner, vitest.

## Global Constraints

- npm, Node 20. DB tests: `npx vitest run --no-file-parallelism`.
- Every new string in BOTH `messages/en.json` + `messages/th.json`; run the flat-key parity check before each commit.
- Verify per package: `npm run typecheck` && `npm run lint` && full vitest; curl smoke the touched routes as admin/requester/station (dev server on :3000, dev sign-in `seed-user-admin` / `seed-user-requester` / `seed-user-driverstation`).
- Spec: `docs/superpowers/specs/2026-07-08-ux-improvement-pass-design.md` — policy details (A5 revert rule, D1 windows) live there.
- Commit per package: `feat(requester): …` / `feat(admin): …` / `feat(kiosk): …` / `feat(roster): …`, push after each.

---

### Package A — Requester visibility

**Files:** `app/(requester)/requester/upcoming/page.tsx`, `lib/email/templates.ts`, `lib/booking/driver-actions.ts` (endTrip email), the cancel action in `lib/booking/actions.ts`/`extra-actions.ts` (locate `cancel`), time-change action + `app/(requester)/requester/[id]/page.tsx`, history page + `components/requester-history-client.tsx`, `components/requester-booking-list.tsx`, `app/(requester)/requester/new/page.tsx` + `components/forms/booking-form.tsx` (prefill), i18n.

- [ ] **A1** Upcoming page: add two queries (future PENDING_APPROVAL / WAITLIST for the session user) alongside the existing confirmed query; render three titled sections, each only when non-empty; EmptyState only when all empty. i18n keys `upcoming.sectionConfirmed|sectionPending|sectionWaitlist`.
- [ ] **A2** Emails: add `requesterCompletedEmail` (trip summary + evaluate CTA → `/requester/<id>`) and `requesterCancelledEmail` to `lib/email/templates.ts` following the existing bilingual template shape. Fire completed-email in `endTripAction` after the transaction (try/catch, non-blocking). Fire cancelled-email in the cancel action ONLY when `session.user.id !== booking.requesterId`.
- [ ] **A3** Re-book: "Book again" link on completed rows (history client + booking detail) → `/requester/new?from=<id>`. In `new/page.tsx`: when `from` present, load booking scoped to `requesterId: session.user.id`, map to the template-field shape, pass as `prefill` prop; `BookingForm` applies it via the same code path template-apply uses (dates/recurrence excluded). Guard silently ignores foreign/missing ids.
- [ ] **A4** History filters: server page reads `?fromDate&toDate&status` searchParams into the Prisma where; add a small client filter row (two date inputs + status checkboxes) that pushes URL params via `router.replace`. Defaults = current behavior.
- [ ] **A5** Time change: extend the action's allowed statuses to APPROVED (no side effects) and ASSIGNED (revert: clear vehicleId/primaryDriverId/secondaryDriverId, `status: "APPROVED"`, `driverScheduleStatus: "UNCLAIMED"`, `decidedAt: null`; recompute rotation stamps for freed drivers — reuse `recomputeRotationStamp`; audit `TIME_CHANGE_REASSIGN`; email admins with the existing admin template). Render the form on the detail page for all three statuses with a warning note for ASSIGNED. New-startAt-in-future guard.
- [ ] **A-verify** typecheck+lint+vitest, i18n parity, curl `/requester/upcoming`, `/requester/history?status=COMPLETED`, `/requester/new?from=<seed id>`; commit + push.

### Package B — P'Top queue speedups

**Files:** `app/(admin)/admin/page.tsx`, `components/forms/approver-queue-actions.tsx`, new `components/admin/queue-filter-bar.tsx` + `components/admin/queue-bulk-actions.tsx` (client), assignment action reuse (`lib/booking/matching-actions.ts` or the assign form action — read first), i18n.

- [ ] **B1** Extend the pending-query select (jobType, passengerCount, estimatedDistance, needsSecondaryDriver, createdAt already?) and render the compact info row on each card (jobType chip using the board's color map, pax, km, "submitted X ago" via date-fns `formatDistanceToNow` with locale, co-driver icon).
- [ ] **B2** `queue-filter-bar.tsx`: jobType multi-select chips + overdue toggle + sort select, all writing URL params; server page parses params into where/orderBy. `take: Math.min(limit ?? 100, 500)` on pending + "show more" link that bumps `?limit`.
- [ ] **B3** Split WAITLIST into its own section with the amber banner (i18n `adminQueue.waitlistBanner`); inline deny asymmetry resolved by keeping deny on pending only (unchanged behavior).
- [ ] **B4** One-click OT assign: on waitlist cards with a reco, an Assign button (client) → confirm dialog → call the existing assign action with the reco's vehicleId (+ secondary if present) → toastResult + `router.refresh()`.
- [ ] **B5** Bulk mode: select-toggle state in a client wrapper for the pending section; checkboxes per card; bottom bar with Approve-all-selected (sequential `approveBookingAction`, collect failures) and Deny-all-selected (one shared preset/reason via existing deny action). Summary toast "{ok} approved, {fail} failed".
- [ ] **B-verify** typecheck+lint+vitest, parity, curl `/admin?jobType=TJW&sort=oldest`; sim `mixed` (booking actions untouched — expect 0s); commit + push.

### Package C — Kiosk glance-ability

**Files:** `app/(driver)/driver/schedule/page.tsx`, `components/driver/driver-schedule-board.tsx`, new `components/driver/today-trips-panel.tsx` (server) + `components/driver/kiosk-refresh.tsx` (client), `components/forms/trip-forms.tsx`, i18n.

- [ ] **C1** `today-trips-panel.tsx`: props = today's bookings (already loaded) + trip state; chronological list, status chip upcoming/in-progress/done (from `trip`/`trip.endedAt` — extend the page query to include `trip: { select: { startedAt, endedAt } }`), highlight ring on the next trip starting within 60 min. Render above the board only when viewing today.
- [ ] **C2** Size pass in `driver-schedule-board.tsx`: hour labels → `text-xs`, block primary line → `text-sm`, secondary → `text-xs`, lane height constant +25%.
- [ ] **C3** `kiosk-refresh.tsx`: `useEffect` interval 60 s → `router.refresh()` when `document.visibilityState === "visible"`; renders "updated HH:mm" + refresh button. Mount on the kiosk schedule page.
- [ ] **C4** Trip toasts in `trip-forms.tsx`: on successful start → success toast; on successful end → toast with km (end−start), fuel, tollway from the submitted values. Uses existing sonner.
- [ ] **C-verify** typecheck+lint+vitest, parity, curl `/driver/schedule` as station (panel present, updated badge); commit + push.

### Package D — Roster & fleet alerts

**Files:** new `lib/admin/roster-alerts.ts` + `lib/admin/roster-alerts.test.ts`, `app/(admin)/admin/drivers/page.tsx` + `components/admin/drivers-list-client.tsx`, `app/(admin)/admin/dashboard/page.tsx`, `app/(admin)/admin/fleet/page.tsx` + `components/admin/fleet-editor.tsx` + fleet server action file, new CSV export button (client, in drivers list), i18n.

- [ ] **D1** TDD `roster-alerts.ts`: `licenseStatus(expiresAt, now)` (none/ok/expiring[≤60d]/expired) + `retirementStatus(beYear, now)` (none/ok/soon[=currentBE+1]/due[≤currentBE]); `toBEYear(now)` helper. Write failing tests first (boundaries: exactly 60d, expiry today, BE conversion, due vs soon).
- [ ] **D2** Drivers page query adds licenseExpiresAt/retirementYear/notes; list rows render badges (amber `expiring`/`soon`, red `expired`, muted `due`→"เกษียณแล้ว"?) — colors follow existing badge patterns; notes snippet truncated one line.
- [ ] **D3** Dashboard: compute alert lists server-side with D1 helpers; render "Roster alerts" card (only when non-empty) with driver links.
- [ ] **D4** Fleet: query type/capacity; per-row type `SelectField` + capacity number input + save via new `adminUpdateVehicleAction` (zod: VehicleType enum, int 1–60; requireRole ADMIN; revalidate /admin/fleet + /admin/schedule).
- [ ] **D5** CSV export button on drivers list (client blob, UTF-8 BOM for Thai Excel, columns per spec).
- [ ] **D-verify** typecheck+lint+vitest (incl. new unit tests), parity, curl `/admin/drivers`, `/admin/dashboard`, `/admin/fleet`; commit + push.

## Self-Review

- Spec coverage: A1–A5, B1–B5, C1–C4, D1–D5 all mapped 1:1 to spec sections. ✓
- No placeholder steps; file targets named; policies (A5 revert, D1 windows) pinned in the spec. ✓
- Reuse: approve/deny/assign/rotation/email all existing — no new booking mutations invented. ✓
