# Handoff — rent_car

Quick state snapshot for resuming work in a fresh session.

## Where we are

All 5 phases of `claude_code_implementation_plan.md` shipped. Since
**2026-06-22** the work has been: a booking-input overhaul (trip areas,
templates, vehicle type, SMUS charter, attachments), two scheduling changes
(no-wait **split-legs**, **TJW-by-request-order**), an org change (**APPROVER
role removed**, station-only drivers), an admin **driver-management** section,
a **QoL** pass (toasts/skeletons/search/empty-states), header/profile UI polish,
and (2026-07-08→09) an audit-driven UX pass, the **official Thai form PDF**,
gated **Adobe Sign / Google Maps** integrations, a **LESS** submission tracker,
and the **nginx/Linux deployment kit** (see the two newest sessions).
**Test suite: 350 tests across 42 files** (was 255 / 25).

> The session entries below are newest-first. Entries under **Earlier sessions**
> predate 2026-06-22 and are kept for architecture context; where a newer change
> overrode them it's flagged ⚠️.

---

### Session 2026-07-09 — official form, integrations, deployment kit

Diagram-driven feature pass + go-live prep. Suite now **350 tests / 42 files**.
Audit of the FigJam workflow diagram: `docs/archive/workflow-diagram-audit-2026-07-08.md`.

- **Official form PDF** (`b6a4023`): the booking-PDF download now fills the real
  faculty AcroForm (`public/2 แบบฟอร์มขออนุมัติ…e.pdf`, 57 fields) from booking
  data via **pdf-lib + Noto Sans Thai** (`lib/pdf/official-form.ts`,
  `bookingToFormFields` unit-tested), rendered LIVE at download; signature fields
  left blank for e-sign. Retired `booking-pdf.tsx` (react-pdf now unused). Verify
  a fill with `qlmanage -t`, NOT `sips`. See [[official-form-pdf]].
- **Adobe Sign** (`5ee5c90`, dormant): `lib/adobe-sign/*` + `/api/adobe-sign/webhook`
  + admin "Send for signature" — gated on `ADOBE_SIGN_*` env (inert until set).
  Head signer only. Free alternative (stamp the on-file signature) still parked.
- **Google Maps distance** (`ab0d0fc`, gated `GOOGLE_MAPS_API_KEY`) + **outsource
  quote upload** (`Booking.outsourceQuoteUrl`).
- **LESS** (`35def61`): no API — admin downloads the filled form + submits to LESS
  himself; `Booking.lessSubmittedAt` tracker on the detail page. `Trip.fuelType`
  + `parkingCost` added (`dd4ca9e`) for the form's fuel/parking fields.
- **จัดรอบ manual + daily auto-run** (`bbcf416`): core extracted to
  `lib/booking/batch-core.ts` `runBatchForDay(dateStr, actorUserId)` (plain fn,
  not a server action); `/api/cron/run-batch` (secret-gated `CRON_SECRET`,
  assigns tomorrow) + systemd timer. **Simulator feature-flagged**
  (`ENABLE_SIMULATION`, off in prod) via `lib/config/features.ts`.
- **Deployment kit** (`f558610`, `f378285`): `docs/deployment.md` + `deploy/*`
  (nginx, systemd, backup script). `instrumentation.ts` warns if TZ≠Asia/Bangkok
  (scheduling-critical). CI pinned to Asia/Bangkok. See [[deployment-target]].
- **Health scan fixes** (`1e3e04d`): driver/[id] date locale; dup revalidatePath.
  Full runtime scan (all 7 statuses) came back clean.

---

### Session 2026-07-08 — UX improvement pass A–D (audit-driven)

Spec `docs/superpowers/specs/2026-07-08-ux-improvement-pass-design.md` (from a
6-area feature audit; deferred items listed at its end). Suite now **331 tests**.

- **A Requester** (`32c6b79`): Upcoming shows pending/waitlist sections; new
  `requesterCompletedEmail` (evaluate CTA = the eval reminder, no cron) +
  `requesterCancelledEmail` (admin-cancel only); "Book again"
  (`/requester/new?from=<id>` → `BookingPrefill` via the template-apply path);
  history date/status filters; **time edits allowed for APPROVED/ASSIGNED —
  ASSIGNED reverts to APPROVED** (clears car/driver, recomputes rotation
  stamps, emails admins via `adminTimeChangedEmail`).
- **B Admin queue** (`4617016`): card fact row (jobType dot/pax/km/co-driver/
  submitted); URL-persisted filters + sort (`queue-filter-bar`); pending capped
  100 (+show more); WAITLIST split w/ banner; **1-click "Assign as OT"**
  (`ot-assign-button` chains approve + reassign); bulk approve/deny
  (`queue-bulk` context provider around server-rendered cards).
- **C Kiosk** (`698bf19`): `today-trips-panel` (leave order, state chips,
  next-within-60-min ring); `kiosk-refresh` (60 s `router.refresh`, visible-tab
  only); board size pass (`KIOSK_LANE_PX`, 12px labels — admin board
  untouched); trip start/end toasts echoing recorded km/fuel/toll.
- **D Roster/fleet** (`3e892b9`): `lib/admin/roster-alerts.ts` (unit-tested:
  license 60-day window; retirement Thai-BE due/soon); driver-list badges +
  notes snippet + CSV export; dashboard "Roster alerts" card; fleet editor now
  edits vehicle **type + capacity** (`updateVehicleSpecAction`) — enter the
  real fleet's values there (still seed placeholders).

---

### Session 2026-06-30 — org change + admin driver mgmt + feedback + UI

- **APPROVER role removed — admins handle approvals.** `Role` enum is now
  `REQUESTER | ADMIN | DRIVER` only (migration `20260630130000_remove_approver_role`,
  `prisma/schema.prisma:15`). `canApprove()` checks `role === "ADMIN"`
  (`lib/booking/approval-actions.ts`); the `/admin` queue is `requireAnyRole(["ADMIN"])`
  (`app/(admin)/admin/page.tsx`). A few code comments still say "APPROVER" —
  historical only, no behaviour. ⚠️ Supersedes the approver-console session below.
- **Station-only drivers; no individual driver logins.** Drivers sign in through a
  single shared kiosk account `driverstation@chula.ac.th` (allowlist
  `DRIVER_STATION_EMAILS`, `lib/auth/station.ts`). `scripts/wipe-data.ts` clears
  `passwordHash` for every non-station driver, and login fails without a hash
  (`auth.ts`), so only the station can sign in as DRIVER. Driver *records* are kept
  for scheduling — just passwordless.
- **Admin driver management** (`/admin/drivers`, spec
  `docs/superpowers/specs/2026-06-30-admin-driver-management-design.md`). Roster list
  (`components/admin/drivers-list-client.tsx`, ListSearch over name/nickname/phone/vehicle,
  inactive badge) → per-driver edit (`/admin/drivers/[id]`):
  `DriverEditForm` (roster fields + 1:1 vehicle assign) and `DriverCredentials`
  (username + password reset, reuses `adminResetPasswordAction`). Actions in
  `lib/admin/driver-actions.ts` (`adminUpdateDriverAction`, `adminSetDriverUsernameAction`).
  Guards (commit `12cd45c`): reject stealing a car already held by another driver
  (`vehicleAssignedElsewhere`), server-side name-required, no double-translated
  password error. New `Driver` fields: `nickname, licenseType, position,
  retirementYear, notes`.
- **1–5 star feedback + per-driver dashboard** (spec
  `docs/superpowers/specs/2026-06-30-driver-star-feedback-design.md`).
  `Evaluation.rating` is now `Int` 1–5 (was the `EvaluationRating`
  NOT_GOOD…VERY_GOOD enum; migration `20260630140000_evaluation_star_rating`).
  Submit via `components/forms/evaluation-form.tsx` → `submitEvaluationAction`
  (`lib/booking/extra-actions.ts`). UI in `components/ui/star-rating.tsx`
  (`StarRatingInput` = 5 plain keyboard buttons, no fake ARIA radiogroup;
  `StarRatingDisplay` = fractional-fill for averages). Dashboard
  `app/(admin)/admin/evaluations/page.tsx` aggregates by `primaryDriver` and
  **includes inactive drivers that have reviews** (`OR isActive | id in …`);
  drill-in `[driverId]/page.tsx` lists reviews newest-first.
- **Header profile dropdown** (`components/profile-menu.tsx`) — avatar (initials)
  → name/role, Account, Change Password, Sign Out. Three Base UI v1.4.1 gotchas
  fixed: GroupLabel-needs-a-Group crash (`20af311`, header is now a plain `div`),
  avatar `ml-2` (`07eca49`), and **`onClick` not `onSelect`** (`4e4eb4d`) — Base UI
  `MenuItem` has no `onSelect`; the old prop spread onto the `<div>` as the DOM
  text-selection event so the items were dead on click.

### Session 2026-06-29 — quality-of-life pass

Spec `docs/superpowers/specs/2026-06-29-qol-updates-design.md`. No scheduling/booking
logic touched.

- **Toasts** — `<Toaster richColors closeButton />` in `app/layout.tsx`; new
  `useActionToast()` (`components/hooks/use-action-toast.ts`) → `toastResult(res, {success})`
  wired into booking submit, approve/deny, batch + TJW assign, board
  assign/unassign/reassign, driver claim/decline. Success toast only when the flow
  doesn't redirect. Bilingual `toast.*` keys.
- **Live list search** — pure `filterRows(rows, query, keys)` + `<ListSearch>`
  (`components/list-search.tsx`, unit-tested) on users / history / fleet /
  evaluations. Client filter only (lists are small); no server pagination.
- **Loading skeletons** — per-route `loading.tsx` for 8 heavy routes
  (admin schedule/batch/calendar/users/fleet, requester upcoming/history, driver board).
- **Empty states** — shared `EmptyState { icon, title, description?, action? }`
  across requester/driver/admin lists.

### Session 2026-06-26 — scheduling: no-wait split-legs + TJW-by-request-order

- **No-wait trips split into two legs** (spec
  `docs/superpowers/specs/2026-06-26-no-wait-trip-split-legs-design.md`). When
  `waitAtDestination = false`, a booking is two intervals: leg 1 `[startAt, dropOffDone]`
  (drop-off run), leg 2 `[pickupReturnTime, endAt]` (return) — the freed middle is
  real bookable capacity. New nullable `Booking.dropOffDone` /
  `TripTemplate.dropOffDone` (migration `20260626130000_add_drop_off_done`; `null`
  ⇒ single interval, fully back-compat). **Single source of truth
  `lib/booking/trip-legs.ts`**: `tripLegs()`, `legsOverlap()`, `minLegGapMinutes()` —
  all overlap/2h-gap math routes through it. `canChain` (`rotations.ts`), the matcher
  + solver (`batch-actions`, `matching-actions`, `batch-solver`, `driver-capacity`),
  and manual reassign/conflict-resolve (`conflict-resolve`, `schedule-actions`) are all
  leg-aware. Zod requires `startAt < dropOffDone < pickupReturnTime < endAt`, same day.
  Board renders leg-1 block + a read-only dashed **return-leg ghost** (same booking
  `id` → DnD moves the whole trip; `scheduler-board-blocks.tsx`). Docs:
  `scheduling-algorithm.md` §4–5. *(Board renders both legs; the other same-day
  day-views render one entry per booking — unchanged.)*
- **TJW assigned by request order** (spec
  `docs/superpowers/specs/2026-06-26-tjw-request-order-assignment-design.md`). TJW
  no longer flows through the daily `solveDay` priority cascade. A separate global
  pass `solveTjwByRequest` (`lib/booking/tjw-request-solver.ts`, pure) sorts **all**
  pending TJW by `createdAt` (request order, not trip date), assigns the fairest
  eligible driver via `rankForRotation(lastTjwAt)` with provisional stamping, pairs a
  >400 km co-driver or overflows `NO_SECONDARY_DRIVER`. Driven by
  `assignTjwByRequestOrder` (`lib/booking/tjw-request-actions.ts`) + a batch-console
  button (`batch-run-form.tsx`); idempotent (only unassigned TJW). `runBatchAction`
  now **excludes** `jobType = "TJW"` from its pending query (`batch-actions.ts`).
  ⚠️ Supersedes the "TJW → OT → WERN → NORMAL enforced in `solveDay`" note below —
  `solveDay` now sees only OT/WERN/NORMAL.

### Session 2026-06-24 — booking-input & classification overhaul

Spec `docs/superpowers/specs/2026-06-24-booking-input-classification-design.md`.

- **Trip area** — 4-way selector `WITHIN_CHULA | BANGKOK_METRO | UPCOUNTRY |
  SMUS_CURRICULUM` (replaces the old in-Chula toggle + out-of-province boolean);
  drives lead time (3 business days Chula/Bangkok, 7 upcountry, 30 calendar days SMUS)
  + routing. `InChulaChip` surfaces it on requester detail / admin queue / board.
- **Vehicle type** — required `preferredVehicleType` (`PreferredVehicleType`:
  VAN / TRUCK_6_WHEEL / PICKUP / SEDAN_DEAN / BUS_OUTSOURCED; default VAN).
  Informational — does **not** drive assignment. BUS_OUTSOURCED sets `needsOutsourcing`
  and is excluded from internal allocation.
- **Trip templates** — `TripTemplate` model stores every form field except
  dates/recurrence; `/requester/new` shows a template card grid (rename/delete),
  CRUD in `lib/booking/template-actions.ts`.
- **One-way trips** — `returnTrip` (default true); when false the requester leaves
  the return blank and admin sets the real end at approval (provisional `endAt = start+3h`).
- **Required Maps link** — `googleMapsUrl` required, `.url()` + protocol refine
  (rejects `javascript:`/`data:`); never auto-fetched (cost). Carried by templates +
  recurrence children.
- **Attachments** — `attachmentUrl` / `attachmentFilename`; upload on the form,
  served via `/api/files/booking-attachment` (`lib/storage.ts`).
- **Saved places — REMOVED.** Built in `c7caa13`, the UI was removed `2026-06-30`
  (`ff0c141`). The `SavedPlace` model still exists in schema but is **orphaned** (no
  page, no actions, no FK — bookings copy values at submit time). Candidate for a
  future destructive migration.

### Data model + migrations + tests (spanning 06-23 → 06-30)

- **6 new models**: `SavedPlace` (orphaned, see above), `TripTemplate`,
  `RecurrenceRule` (parent booking + iCal rrule), `BookingDraft` (driver-side schedule
  proposals, off the official assignment until applied), `AdHocVehicle` (per-day
  external vendor rows the board can drop OUTSOURCED trips onto), `DriverUnavailability`
  (per-driver per-day off; `@db.Date`, unique(driverId, date); excluded via the pool
  loaders, fairness self-heals — 0 earnings, rotation stamps untouched).
- **3 new enums**: `VehicleType` (owned fleet), `PreferredVehicleType` (requester
  preference), `DriverPool` (PUBLIC | PRIVATE, on `Driver.pool`).
- **New `Booking` columns**: `dropOffDone`, `returnTrip`, `waitAtDestination`,
  `waitingLocation`, `preferredVehicleType`, `externalBusCount`/`externalVanCount`
  (SMUS only), `googleMapsUrl`, attachment fields.
- **19 migration folders** `20260623…` → `20260630…` (DriverUnavailability,
  BookingDraft, OUTSOURCED status, AdHocVehicle, TripTemplate, VehicleType +
  secondary driver, waitAtDestination, travel-within-chula, SavedPlace + Maps URL,
  waitingLocation, SMUS counts, dropOffDone, returnTrip, attachment, driver roster
  fields, remove-APPROVER, evaluation star rating).
- **Tests: 35 files / 332 cases.** Notable new: `tests/station-trip.test.ts`,
  `tests/driver-unavailability.test.ts`, `lib/places/schema.test.ts`.

---

## Earlier sessions (historical — pre 2026-06-22)

### Approver console + conflict-aware auto-assign + bug fixes

> ⚠️ The APPROVER role was removed on 2026-06-30 — this console, its triage badges,
> and `/admin/decisions` now serve **ADMIN**. The auto-assign / conflict-resolve and
> the bug fixes below are still current.

- **Approver page (`/admin` queue).** Inline Approve/Deny per pending card
  (`components/forms/approver-queue-actions.tsx`), canned deny-reason chips
  (`lib/booking/deny-presets.ts` + `deny-preset-chips.tsx`), queue triage
  (`lib/booking/triage.ts` — emergency / outOfHours / shortLead / dayFull /
  repeatCanceller, `SLA_WARN_HOURS = 24`), decision-context card on the detail page,
  and a "My decisions" audit at `/admin/decisions`.
- **Auto-assign resolves overlap conflicts.** The board's จัดอัตโนมัติ button places
  the Unassigned queue *and* re-homes the loser of every overlap among assigned trips:
  `resolveScheduleConflictsAction` (`schedule-actions.ts`) + pure
  `conflict-resolve.ts` (`pickConflictLoser` / `findConflictLosers`). WERN/duty is
  **pinned** — never the loser; only a free non-duty car auto-resolves.
  > ⚠️ **2026-07-22:** this auto-resolve pass was **never shipped** (or was later
  > removed) — `conflict-resolve.ts` / `resolveScheduleConflictsAction` exist in no
  > source file. Auto-assign places the queue only; residual overlaps are manual.
  > See `docs/scheduling-algorithm.md` §8.
- **Bug fixes:** cross-midnight OT detection (`overtime-reco.ts` `isOvernight`),
  sub-minute spill past 16:00 classifies OT (`classification.ts`), `rankCandidates`
  `driverId` `localeCompare` tie-break (`driver-capacity.ts`).
- **`wernReclaimPolicy` wired** (`batch-solver.ts`, docs §6b): `ESCALATE` (default,
  unchanged) / `AUTO_RECLAIM` / `PROTECT_WERN`. Default = no prod behaviour change.
- **Improvement audit** quick-wins + high-impact: closed the dev-auth prod backdoor
  (`lib/dev-auth.ts`), Booking overlap/FK indexes, single-sourced the 400km/work-hour
  constants, DB integration tests for the no-double-book rule, LINE webhook
  fail-closed + timing-safe signature, admin console search, **driver decline path**
  (`declineAssignmentAction` → back to APPROVED, logs `DRIVER_DECLINED`).

### Scheduling correctness + board UX

- **Claimed trips count as commitments** (`booking-status.ts` `COMMITTED_STATUSES` =
  APPROVED|ASSIGNED|COMPLETED) — fixed in `earnings`, `batch-actions`, `matching-actions`.
- **No overlap, ever — not even the duty car.** `reassignVehicleAction` blocks an
  overlapping drop on every car; a manual override may relax only the 2h chaining gap.
  Rule doc §5.
- **Placement reco obeys the rules** — `recommendPlacement` filters by `canChain`
  (overlap + 2h gap + NORMAL cap).
- **Board UX:** drag a block to the Unassigned queue or hover-✕ to unassign
  (`unassignBookingAction`); compact times; `pointerWithin` → `rectIntersection` DnD.
- **Refactors:** audit-log writes in `lib/booking/audit.ts` (`logTransition`);
  `scheduler-board.tsx` split into board / `-blocks` / `-shared`.

### Multi-day calendar rendering + error boundaries

- **Multi-day trips render on every day they span** — pure `lib/booking/day-window.ts`
  (`daySpan()` / `daysSpanned()`); all six day views switched to the overlap query
  (`startAt < dayEnd && endAt > dayStart`).
- **Error robustness** — `error.tsx` + `not-found.tsx` for (admin)/(driver)/(requester),
  root `global-error.tsx`, shared `ErrorState`/`NotFoundState`, `errorPage` i18n.
  `error.tsx` uses Next 16's `unstable_retry`.

### Matching/scheduling + slot/vehicle audit

- **Matcher consistency** — single-booking `match()` hard-excludes the on-call (WERN
  duty) driver all day, matching the batch solver.
- **Fairness is duration-weighted** — `tripEffort()` (`classification.ts`); effort =
  committed hours (TJW = awayDays × 12, WERN = 0) over a flat 30-day window via
  `loadWeightedEarnings` (`earnings.ts`).
- **Simulation harness** `lib/booking/simulation.ts` (`mulberry32` / `generateDay` /
  `simulate`) — shared by the property fuzz and the dev script. TJW is ALWAYS overnight.
- **car = driver** — a booking's vehicle IS its driver's car (`Vehicle.assignedDriverId`);
  the old slot grid is dead code (`slot-allocation.ts` keeps only `bucketFromStart`).
- **Overflow reduction: CLOSED** — solver ≈94% of the priority-respecting optimum; see
  `docs/superpowers/specs/2026-06-10-overflow-reduction-decision.md`. Cutting overflow is
  a business lever (cap / drivers), not code.
- Category priority **OT → WERN → NORMAL** (FCFS within each) in `solveDay`.
  ⚠️ TJW was removed from `solveDay` on 2026-06-26 (now a request-order pass, above).
- **Rules: documented + test-enforced** — source of truth `docs/scheduling-algorithm.md`
  (priority; `canChain`; no-overlap; >400 km co-driver). Read it before touching
  `lib/booking/*`.

### Earlier session deltas

- Email: bilingual TH/EN approval template + CTA + integration tests
- Dark mode via next-themes + header toggle
- Calendar: density tint, count badge, conflict marker, vehicle filter
- Reporting: monthly buckets with locale-aware month names
- KPI cards: semantic colors

## Open / pending

- **Signature (parked):** head + recipient sign-off on the official form. The
  free path (stamp the on-file `signatureImageUrl` into the form's blank
  signature fields via pdf-lib) is designed, not built. Adobe Sign covers it if
  configured; otherwise this is the remaining diagram gap.
- **Deployment**: target decided — self-hosted **nginx + Linux + systemd**
  (`docs/deployment.md`, [[deployment-target]]). Not yet deployed: provision the
  box, set `/etc/rent_car.env`, pin `TZ=Asia/Bangkok`. Prod DB still hosted by
  Chula IT (connection string pending); local dev = Docker/Homebrew Postgres 16.
- **Gated integrations** (inert until env set): Adobe Sign (`ADOBE_SIGN_*`),
  Google Maps (`GOOGLE_MAPS_API_KEY`), daily batch cron (`CRON_SECRET`).
- **LINE notifications**: scope confirmed driver-only. Code paths exist
  (`lib/line/client.ts`, webhook, assign-notify). Live channel needs interview answers
  (ownership, budget, LIFF vs email-in-chat). See `memory/line_scope.md`.
- **Resend**: optional. `RESEND_API_KEY` empty → console fallback. README §5.
- **Test residue**: a few `lib/booking/*.test.ts` insert + delete fixture rows on the
  real dev DB. `scripts/seed-calendar-cluster.ts` seeds a demo cluster (re-run safe).

## Conventions

- HARNESS_PROTOCOL.md is the short rule sheet; full spec
  `docs/harness-protocol-full.md`.
- Memory at `~/.claude/projects/<sanitized-cwd>/memory/` is the source of truth for
  user preferences (DB plan, LINE scope, Thai vocab).
- Matching/scheduling design + decision specs live in `docs/superpowers/specs/`; the
  simulation harness is the measurement instrument for that subsystem.
- Bilingual UI: Thai + English via next-intl (`getLocale()` / `useLocale()`) and
  `date-fns/locale/{th,enUS}`.

## Don't propose

- Migrating Postgres to Neon/Supabase/etc. Chula handles prod.
- LINE for requester/admin — drivers only.
- Bringing back the APPROVER role — removed by design; admins approve.
- Bringing back individual driver logins — drivers sign in at the shared station kiosk.
