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
and the **nginx/Linux deployment kit**, then (2026-07-17→08-10) a pre-deployment
audit and the go-live pass it triggered: a **driver leave/sick-day** rework, the
**drag-and-drop timeline restored** alongside the rounds board, a **รอเอกสาร**
stage between approval and dispatch, and the **VB job number deleted** outright,
then (2026-08-11) a whole-app audit pass — a recurring booking is now **one card
and one approval**, the queue paginates, and the i18n keys have a test.
**Test suite: 407 tests across 48 files** (was 389 / 43).

> The session entries below are newest-first. Entries under **Earlier sessions**
> predate 2026-06-22 and are kept for architecture context; where a newer change
> overrode them it's flagged ⚠️.

---

### Session 2026-08-11 — audit pass, series-as-one-card, queue paging

Suite now **407 tests / 48 files**. No schema changes.

- **A recurring booking is one card and one approval** (`580f6d4`, `03ec137`):
  the queue grouped nothing, so a 24-week series filled the page with 24
  identical cards. `lib/booking/series.ts` groups by `recurrenceParentId` and
  the page limit counts **cards, not rows** — a five-week series is one card,
  not five. `approveSeriesAction` / `denySeriesAction` act on the whole group.
  The occurrences do **not** share a fate: the fleet can be free on the 23rd and
  full on the 30th, so the action reports **per day** and the days that could not
  go through stay `PENDING_APPROVAL`. Blocked days are named in a **toast**, not
  an inline panel — once the successful days leave the queue the card is no
  longer a series and the panel's own component unmounts with the message in it.
- **Document approval reports unplaced days** (`e60a36c`): confirming the
  paperwork runs จัด, and จัด can fail to place a day. `DocumentApproveButton`
  was discarding the series result, so a 24-day series reported clean success
  while some days quietly had no car.
- **A series card no longer prints its first date twice** (this session): the
  "when" line showed `ศ. 14 ส.ค. 08:00–12:00` and the list below opened with
  `14 ส.ค.` — and the weekday was only the first of thirteen days, so a series
  running Tue–Fri was labelled ศ. (Friday). `tripWhenRecurring()` returns the
  shared time alone; a midnight-spanning occurrence keeps the full form because
  the date list cannot express it. The ASSIGNED list still shows its first date
  on purpose — the car and driver named beside it belong to that occurrence.
- **Queue paging keeps your place** (`a8a4a20`, `167eaa1`): five cards per list,
  `scroll={false}` on every show-more link — it was jumping to the top of the
  page and making you scroll back down.
- **i18n keys have a test** (`003ae04`): `driverCalendar.titleStation` was never
  written and shipped a page that threw `MISSING_MESSAGE` — next-intl resolves
  keys at **runtime**, so tsc and the build cannot catch this.
  `tests/i18n-keys.test.ts` resolves every literal `t("…")` against its
  translator's namespace.
- **Three audit defects fixed** (`3deafc9`), each verified before the fix.
- **Verifier drift closed** (this session): CI ran `tsc` + tests but **not
  lint**, while `make check` did and its comment claimed the two matched. CI now
  runs lint. See AGENTS.md § The verifier.

### Session 2026-08-10 — leave rework, รอเอกสาร stage, job number deleted

Go-live pass. Suite now **389 tests / 43 files**. Two schema migrations, both
applied: `20260810120000_audit_non_booking_events`,
`20260810140000_awaiting_document_status`, `20260810150000_drop_job_number`.

- **Driver leave is seat-aware** (`9861a48`): `handOffToDuty` used to write
  `primaryDriverId = เวร, secondaryDriverId = null` whatever seat the absent
  driver held, so marking the **co-driver** of a >400 km trip sick threw the
  primary off their own trip and dropped the second driver the rule requires.
  Now the sick co-driver costs only that seat, and a primary hand-off KEEPS the
  existing co-driver. A trip that started on an earlier day or has already
  departed is flagged `DRIVER_OFF_NEEDS_REVIEW`, never re-dispatched. The
  affected-trip scan is an overlap query, not start-in-day. Full rule:
  `docs/scheduling-algorithm.md` **§9b**.
- **Audit log widened past bookings** (`9861a48`): `AuditLog.bookingId` is
  nullable with `entityType`/`entityId`, and `logEvent()` records the three
  decisions that previously left no trace — leave marked/cleared, a เวร day
  swapped by hand, a car re-paired or removed.
- **Overflow lifecycle fixed** (`233c835`): placing a trip by hand now clears
  `overflowReason` (it did not, so a resolved trip returned to the bar with no
  way to dismiss it), `/admin/batch` requires `primaryDriverId: null` so a frozen
  trip can't be one-click re-dispatched, and `clearLeaveDay` decides per trip
  instead of wiping flags another off-day still justifies.
- **รอเอกสาร stage** (`7661d73`): `AWAITING_DOCUMENT` sits BEFORE `APPROVED` in
  the enum on purpose — everything keyed on APPROVED is untouched; only *when*
  จัด runs moved. `approve → รอเอกสาร → [เอกสารเรียบร้อย, ADMIN only] → APPROVED
  + จัด`. `ดาวน์โหลดเอกสาร` on every card that has a generated form.
- **VB job number deleted** (`1eff538`): gone from schema, database and 45 files.
  Email subjects and the PDF download filename now use ชื่อการจอง / destination;
  seed and test teardowns re-keyed from job-number prefixes onto tag-scoped
  `purpose` prefixes (a naive removal would have widened those WHEREs to every
  booking). Dropped a Postgres advisory lock + count that ran on every insert.
- **SMUS restored** (`37df786`): `9ccc55a` had retired it, taking the 4th
  `พื้นที่เดินทาง` button (`หลักสูตรนิสิตแพทย์`) and leaving a hole in a 2×2 grid
  built for four. Back with its bus/van counts and 30-**calendar**-day lead tier.
  ⚠️ §2 of the algorithm doc previously said SMUS was retired — it is live.
- **UI** (`bb0dfcc`, `68ae907`): all three native `<select>` elements converted to
  `SelectField` (an open `<select>` is OS-drawn and ignores the theme),
  วัตถุประสงค์ → **ชื่อการจอง**, คอนโซล → รายการคำขอ, and the timeline's unplaced
  cards no longer print a recommended plate/driver as though already assigned.

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
  > ⚠️ **2026-07-22 (`d82ca7c`):** Adobe Sign was **removed** — all `lib/adobe-sign/*`,
  > the webhook route, and the Send-for-signature button are deleted. Replaced by the
  > requester-owned signature-stamp (`stampRequesterSignature`).
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
  Docs: `scheduling-algorithm.md` §4–5. *(The timeline board that drew a dashed
  return-leg ghost has since been deleted; the rounds board and the other same-day
  day-views render one entry per booking.)*
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
  *(Superseded — the timeline board was deleted; unassign now lives on the rounds
  board's per-round control.)*
- **Refactors:** audit-log writes in `lib/booking/audit.ts` (`logTransition`);
  `scheduler-board.tsx` split into board / `-blocks` / `-shared` *(all three since
  deleted with the board)*.

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

- **Signature:** the requester's own signature stamp **SHIPPED** (2026-07-22,
  `d82ca7c`): `stampRequesterSignature` draws their registered `signatureImageUrl`
  image into the requester signature field via pdf-lib. **Adobe Sign was removed**
  in the same commit. The department head + driver still sign the printed copy by hand.
- **Deployment**: target decided — self-hosted **nginx + Linux + systemd**
  (`docs/deployment.md`, [[deployment-target]]). Not yet deployed: provision the
  box, set `/etc/rent_car.env`, pin `TZ=Asia/Bangkok`. Prod DB still hosted by
  Chula IT (connection string pending); local dev = Docker/Homebrew Postgres 16.
- **Gated integrations** (inert until env set): Google Maps
  (`GOOGLE_MAPS_API_KEY`), daily batch cron (`CRON_SECRET`). (Adobe Sign was
  removed 2026-07-22 — replaced by the requester signature-stamp.)
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
