# UX improvement pass (A–D) — design

**Date:** 2026-07-08
**Status:** approved (brainstorm + audit)
**Source:** 6-area feature audit (requester, admin-requests, admin-scheduling,
people/insights, station kiosk, cross-cutting), 48 gaps, distilled to 4 packages
approved by the user. Fixed design context (do NOT reverse): drivers passive —
P'Top decides all assignments; shared station kiosk login; car=driver 1:1;
DB-level no-double-book; 5-section admin nav.

---

## A — Requester visibility & follow-through

**A1. Upcoming page shows the whole pipeline.** `/requester/upcoming` today
filters to driver-confirmed APPROVED/ASSIGNED/COMPLETED in today/tomorrow —
pending bookings vanish. New layout, three sections:
1. *Confirmed (today/tomorrow)* — current query, unchanged.
2. *Awaiting approval* — the requester's future `PENDING_APPROVAL` bookings.
3. *Waitlist* — future `WAITLIST` bookings, with the existing waitlist
   explanation copy.
Sections render only when non-empty; EmptyState only when all three are empty.

**A2. Completion + cancellation emails.** `lib/email/templates.ts` gains
`requesterCompletedEmail` (bilingual, includes trip summary + a prominent
"evaluate this trip" CTA link to `/requester/<id>` — this IS the eval reminder;
no cron exists and none is added) and `requesterCancelledEmail`. Send:
- completed → in `endTripAction` after the transaction commits (non-blocking,
  same try/catch pattern as existing notification emails).
- cancelled → only when the canceller is NOT the requester (admin cancel path);
  a requester cancelling their own booking gets no self-email.

**A3. Re-book from history.** Completed bookings (history rows + booking detail)
get a "Book again" link → `/requester/new?from=<bookingId>`. The new-booking
page, when `from` is present, loads that booking (guard: must belong to the
session user), maps it to the same field-shape templates use, and passes it to
`BookingForm` as an initial prefill (purpose, destination, maps URL, province,
trip area flags, passengers, vehicle type, contacts, wait/no-wait…) with **dates
left empty**. Reuses the template-apply pathway; no new persistence.

**A4. History filters.** `/requester/history` gains a filter row: date range
(from/to), status (COMPLETED / DENIED / CANCELLED), applied **server-side** via
URL search params (shareable/bookmarkable). Text search stays client-side as
today. Defaults: no date bound, all terminal statuses.

**A5. Time edits after approval.** The time-change form currently renders only
for `PENDING_APPROVAL`. New policy:
- `PENDING_APPROVAL` → unchanged.
- `APPROVED` → time change allowed; booking stays APPROVED (not yet dispatched).
- `ASSIGNED` → time change allowed, but the booking **reverts to APPROVED**:
  vehicle/primary/secondary cleared, `driverScheduleStatus: UNCLAIMED`, freed
  drivers' rotation stamps recomputed (same helper the decline path used),
  audit-logged, admins emailed (existing admin notification template). P'Top
  re-dispatches at the new time — preserves "P'Top decides", never leaves a
  stale assignment.
- Guard: new startAt must be in the future; validation identical to the
  existing time-change zod.

## B — P'Top queue speedups

**B1. Richer queue cards.** Pending/waitlist cards add: jobType chip (existing
color language), passenger count, estimated distance (when set),
"submitted X ago" relative time, and a co-driver-needed icon
(`needsSecondaryDriver` or >400 km). Data comes from the existing queue query
(extend `select` as needed).

**B2. Filters + sort + cap.** Filter bar above the queue: jobType multi-select,
"overdue only" (SLA >24h) toggle; sort select (oldest-submitted ·
start-time · risk). All URL-param persisted, applied server-side. Pending query
gets `take: 100` with a "show more" link (`?limit=` growth). Approved/upcoming
sections keep their existing caps.

**B3. Waitlist separation.** WAITLIST bookings move out of the pending list into
their own subsection under an amber "Over capacity — fits as overtime" banner,
keeping their OT recommendation chips.

**B4. One-click OT assign.** Where a waitlist card shows "fits as OT — {driver}
+ {car} at {time}", render an **Assign** button that calls the existing
assignment action with the recommended vehicle/driver prefilled behind a
confirm dialog. Success → toast + refresh; failure surfaces the action's error
(vehicleBusy etc.).

**B5. Bulk actions.** "Select" toggle switches the pending section into
checkbox mode → bulk **Approve** (sequential existing approve action per id;
per-booking failures reported, not aborted) and bulk **Deny** (one shared
deny-preset/reason applied to each). Result summary toast.

## C — Station kiosk glance-ability

**C1. Today's-trips panel.** Above the kiosk board (`/driver/schedule`):
today's ASSIGNED/COMPLETED trips in chronological order — start time, car
registration, destination, driver name, and a status chip (upcoming ·
in-progress [trip started] · done [trip ended]). The next trip starting within
60 minutes gets a highlight ring. Server-rendered from the same day query.

**C2. Readability bump.** `driver-schedule-board.tsx`: hour labels
text-[10px]→text-xs, block text text-[11px]→text-xs (primary line text-sm),
lane height +~25%. Same colors/design language — a size pass, not a redesign.

**C3. Auto-refresh.** Small client component on the kiosk page:
`router.refresh()` every 60 s, "updated HH:mm" badge, manual refresh button.
No SWR/websocket dependency. Pauses while the tab is hidden
(`document.visibilityState`) to avoid useless fetches.

**C4. Trip-recorded confirmation.** After a successful end-trip submit, show a
success toast summarizing what was recorded (distance km, fuel ฿, tollway ฿) via
the mounted sonner Toaster. Start-trip gets a simple "trip started" toast.

## D — Roster & fleet alerts

**D1. Pure alert helpers** `lib/admin/roster-alerts.ts`:
- `licenseStatus(expiresAt: Date | null, now: Date)` → `"none" | "ok" |
  "expiring" | "expired"` — expiring = within 60 days.
- `retirementStatus(retirementYear: number | null /*Thai BE*/, now: Date)` →
  `"none" | "ok" | "soon" | "due"` — BE = CE + 543; `due` when
  retirementYear ≤ current BE year, `soon` when retirementYear = current BE +1.
Unit-tested (the only new pure logic in the pass).

**D2. Drivers list badges.** `/admin/drivers` list rows show license expiry +
retirement year with amber/red badges per D1, and a one-line notes snippet
(second car lives in notes — user's earlier decision; no schema change).

**D3. Dashboard roster-alerts card.** New card on `/admin/dashboard` listing
drivers with `expiring|expired` licenses or `soon|due` retirement, linked to
their `/admin/drivers/[id]` pages. Renders only when there's something to show.

**D4. Fleet type/capacity editing.** `/admin/fleet` queries + displays vehicle
`type` and `capacity`, and lets ADMIN edit them per row (type = VehicleType
select, capacity = int 1–60) via a new server action (zod-validated,
requireRole ADMIN, revalidates fleet + schedule). Needed because the real
fleet's type/capacity are still seed placeholders.

**D5. Roster CSV export.** Button on `/admin/drivers`: client-side CSV blob
(pattern copied from the dashboard export) with name, nickname, phone, license
type/number/expiry, position, retirement year, car, active.

## Cross-cutting rules

- Every new user-facing string ships in **both** `messages/en.json` and
  `messages/th.json` (parity check before each commit).
- No scheduling-rule changes; anything touching `lib/booking/*` hotspots reuses
  existing actions/helpers (assign, approve, deny, rotation recompute).
- Verify per package: `tsc --noEmit`, `eslint`, full vitest
  (`--no-file-parallelism`), i18n parity, curl smoke of the touched routes;
  package B/C additionally `simulate-cr07 --scenario=mixed` untouched-invariant
  check if any booking action changed.
- One commit set per package (A → B → C → D), pushed to main after each
  passes.

## Out of scope (deferred, from the same audit)

Multi-step mobile booking form rewrite; offline/PWA kiosk; bilingual PDF;
detail-page skeletons; mobile admin-nav grouping; notification-bell freshness;
structured second-vehicle schema; batch dry-run + undo stack; reco
explainability; OnCallShift history UI.
