# Handoff — rent_car

Quick state snapshot for resuming work in a fresh session.

## Where we are

All 5 phases of `claude_code_implementation_plan.md` shipped.

### Latest session — approver console + conflict-aware auto-assign + bug fixes

- **Approver page (`/admin` queue, shared ADMIN+APPROVER).** Inline
  Approve/Deny on each pending card (`components/forms/approver-queue-actions.tsx`
  — one-tap approve via `approveBookingAction`; deny expands in place via
  `denyByApproverAction`), so the queue clears without opening every detail page.
  The notification bell is un-gated for approvers (`app/(admin)/layout.tsx`:
  `showBell = isAdmin || roles.includes("APPROVER")`) — its count is
  PENDING_APPROVAL + WAITLIST.
- **Canned deny-reason chips.** `lib/booking/deny-presets.ts` (`DENY_PRESET_KEYS`:
  noVehicle / leadTime / duplicate / outOfPolicy / missingDetails) +
  `components/forms/deny-preset-chips.tsx`; reused on the detail-page
  `ApproverDenyForm` (`components/forms/approve-form.tsx`).
- **Queue triage.** `lib/booking/triage.ts` (`triageFlags` — emergency / outOfHours
  / shortLead / dayFull / repeatCanceller, reusing the rule helpers; `waitingHours`
  + `SLA_WARN_HOURS = 24`) drives per-card triage badges and an SLA banner on the
  queue (`app/(admin)/admin/page.tsx`).
- **Decision-context card** on the booking detail page (`app/(admin)/admin/[id]/page.tsx`):
  day load + free cars at the trip's time + risk flags, so the approve/deny call
  sees supply, not just demand.
- **NEW route `/admin/decisions`** (`app/(admin)/admin/decisions/page.tsx`) —
  approver-scoped "My decisions" audit (every booking this approver approved/denied,
  filterable), linked in the approver nav.
- **Auto-assign now resolves overlap conflicts.** The board's จัดอัตโนมัติ button
  (`components/admin/scheduler-board.tsx`) not only places the Unassigned queue but
  also re-homes the loser of every overlap among already-assigned trips:
  `resolveScheduleConflictsAction` (`lib/booking/schedule-actions.ts`) using the new
  pure `lib/booking/conflict-resolve.ts` (`pickConflictLoser` / `findConflictLosers`).
  WERN/duty is **pinned** — never the loser; only a free non-duty car (`fit` reco)
  auto-resolves, so overlap is never auto-relaxed onto the duty car.
- **3 bug fixes:** cross-midnight OT is now detected (`lib/booking/overtime-reco.ts`
  via `isOvernight`); a sub-minute spill past 16:00 (e.g. 16:00:30) now classifies
  OT (`lib/booking/classification.ts`); `rankCandidates` gets a `driverId`
  `localeCompare` final tie-break for determinism (`lib/booking/driver-capacity.ts`).
- **Requester confirmation:** NEW route `/requester/upcoming`
  (`app/(requester)/requester/upcoming/page.tsx`) — the confirmed (driver-assigned)
  trips for today/tomorrow.
- **Test suite: 255 tests** across 25 files. New pure unit tests:
  `triage.test.ts` (12) and `conflict-resolve.test.ts` (16).
- **A rejected board drop now names the conflict.** `reassignVehicleAction`
  returns the conflicting trip(s) on a `vehicleBusy` block (new `ReassignConflict`
  type); the board banner shows each WITH ITS DATE (e.g. "VB-… · 18 Jun
  09:00–11:00") so a multi-day overlap on a day that isn't on screen isn't a
  mystery (`scheduler.dropConflictDetail` i18n).
- **`scripts/` pruned.** Removed 12 stale one-off scripts (old phase-smoke tests
  superseded by the vitest suite, superseded demos/sims, + 2 untracked incl. a
  hardcoded-cred file); kept 9 live tools (sim / seed / maintenance), now indexed
  in `scripts/README.md`. App source untouched — it was already clean.
- **`wernReclaimPolicy` wired** (`batch-solver.ts`, docs §6b). The knob was read
  into config but never consumed (solver always escalated). Now `placeBooking`
  branches on it when a long trip is staffable only by the duty driver:
  `ESCALATE` (default, unchanged) raises `NEEDS_WERN_RECLAIM_DECISION`;
  `AUTO_RECLAIM` takes the duty driver as the co-driver; `PROTECT_WERN` overflows
  `NO_SECONDARY_DRIVER`. Default stays ESCALATE → no prod behaviour change.
- **Improvement audit (49 findings) → quick-wins + high-impact shipped.** Quick
  wins: closed the dev-auth prod backdoor (`lib/dev-auth.ts`, no env escape
  hatch), Booking overlap/FK indexes, single-sourced the 400km/work-hour
  constants, WAITLIST explanation card + confirm-before-disable. High-impact: DB
  integration tests for the no-double-book rule (`schedule-actions.test.ts`),
  LINE webhook fail-closed + signature timing-safe + dropped the email-bind
  hijack (`route.ts` + `tests/line-webhook.test.ts`), admin console search +
  capped the approved query. **Driver decline path**: a driver can decline an
  ASSIGNED trip (`declineAssignmentAction`) — sends it back to the APPROVED
  queue, logs `DRIVER_DECLINED` + reason, emails admins; `DeclineForm` on the
  driver detail page. 255 tests. Deferred (larger): the single batch auto-assign
  action (scheduling-core refactor) and in-app notifications (new model +
  migration). Roadmap also flagged a DB-level EXCLUDE no-double-book constraint.

### Previous session — scheduling correctness + board UX

- **Claimed trips count as commitments** (`lib/booking/booking-status.ts`
  `COMMITTED_STATUSES` = APPROVED|ASSIGNED|COMPLETED). The board matcher leaves a
  claimed trip at status APPROVED; the solver's commitment/availability/earnings
  queries used to filter ASSIGNED|COMPLETED only, so a driver still away on a
  multi-day TJW looked both free (re-assigned while out) and idle (picked again).
  Fixed in `earnings`, `batch-actions` (tjwSpanning + assignedToday), `matching-actions`.
- **No overlap, ever — not even the duty car.** `reassignVehicleAction` blocks an
  overlapping drop on every car; the old duty-car exception is gone. A manual
  override may relax only the 2h chaining gap, never double-book a car. Board
  flags any overlap (duty included) with a red ring. Rule doc §5 updated.
- **Placement reco obeys the rules.** `recommendPlacement` now filters by
  `canChain` (overlap + 2h gap + NORMAL cap), so it never suggests a rule-breaking
  slot; only P'Top overrides, by dragging by hand.
- **Board UX:** drag a scheduled block to the Unassigned queue **or** hover-✕ to
  unassign (`unassignBookingAction` — frees car/driver, releases claims, rolls the
  rotation stamp back). Times are compact (`08:00–12:00` → `08–12`) and contained,
  so short blocks fit. DnD collision = `pointerWithin` → `rectIntersection` with
  `MeasuringStrategy.Always` (the timeline scrolls horizontally).
- **Refactors:** audit-log writes centralized in `lib/booking/audit.ts`
  (`logTransition`); `scheduler-board.tsx` split into board / `-blocks` / `-shared`.
- **Error boundaries** added (see below) — still current.

### Earlier this session — multi-day calendar rendering + error boundaries

- **Multi-day trips render on every day they span.** Day-scoped views queried
  bookings by `startAt`-in-day, so a multi-day TJW (depart Jun 16, return Jun 17)
  vanished on its return/middle days. New pure helper `lib/booking/day-window.ts`:
  `daySpan()` projects a trip onto one viewed day (clamps a spill to the 0/24 axis,
  flags `continuesBefore`/`continuesAfter`); `daysSpanned()` buckets a trip into
  every day-cell it touches. All six day views switched to the overlap query
  (`startAt < dayEnd && endAt > dayStart`) + these helpers: the scheduler board,
  the admin day calendar (agenda + timeline), the admin + driver month grids, the
  driver today/tomorrow dashboard, and the batch ASSIGNED roster (pending/overflow
  stay start-in-day — that's the day's new work to place). Labels show
  `↪ <departure date>` / `↩ <return date>`. 12 `daySpan`/`daysSpanned` unit tests.
- **Short-block label:** a ≤2h block was too narrow for "13:00–15:00". Final form
  (superseding an earlier spill attempt): compact times ("08–12") truncated inside
  the bar — see the latest-session board-UX note above.
- **Error robustness:** the app had NO error/404 boundaries — a thrown server
  action / RSC query or any `notFound()` fell through to Next's bare default
  screen. Added `error.tsx` + `not-found.tsx` for (admin)/(driver)/(requester),
  a root `global-error.tsx` (catches root/group-layout throws), shared
  `ErrorState`/`NotFoundState`, and an `errorPage` i18n namespace. `error.tsx`
  uses Next 16's `unstable_retry` (per the in-tree docs), not legacy `reset`.

### Prior session — matching/scheduling + slot/vehicle audit

- **Matcher consistency:** single-booking `match()` now hard-excludes the
  on-call (WERN duty) driver all day, matching the batch solver — closed a
  pre-dawn leak where the duty driver could be auto-assigned.
- **Fairness is duration-weighted:** `tripEffort()` (`classification.ts`)
  replaced the coarse `JOB_WEIGHT`. Effort = committed hours (OT/NORMAL = real
  hours; **TJW = awayDays × 12**; WERN = 0), summed over the flat 30-day window
  via the shared `loadWeightedEarnings` (`earnings.ts`) — one loader reused by
  the batch, the single-booking matcher, and the overtime recommendation — plus
  the solver/sim provisional stamping.
- **Simulation harness** `lib/booking/simulation.ts` (`mulberry32` /
  `generateDay` / `simulate`): pure, shared by the property fuzz
  (`solver-invariants.test.ts`) and the dev script
  (`simulate-driver-distribution.ts`). Carries multi-day TJW commitments across
  days. **TJW is ALWAYS overnight** (a same-day ต่างจังหวัด trip is NORMAL/OT,
  never TJW); `longTjwProb` = fraction of TJW that run 2–3 days. The instrument
  for any future matching/fairness change. Honest overflow ≈ 40% under the
  synthetic load (the old ≈16–28% was a sim artifact).
- **car=driver model:** a booking's vehicle IS its assigned driver's car
  (`Vehicle.assignedDriverId`) — picking the driver picks the car, no separate
  vehicle search. This retired the old slot grid: `slot-allocation.ts` now keeps
  only `bucketFromStart`; the rest (`buildSlotTable` / `allocateVehicles` /
  `vehicleOccupancyForDay` / `bucketsForTrip`) was deleted as dead code. A driver
  with no assigned car → `NO_SLOT` overflow.
- **Overflow reduction: CLOSED** — the solver is ~94% of the priority-respecting
  optimum; the residual only comes by sacrificing TJW rotation fairness. See
  `docs/superpowers/specs/2026-06-10-overflow-reduction-decision.md`. Cutting
  overflow is a **business lever** (raise the 2-job cap / add drivers), not a
  code change.
- Category priority **TJW → OT → WERN → NORMAL** (FCFS within each) is enforced
  in `solveDay`; lint is clean (0); the fairness fuzz is seed-robust.
- **Scheduling rules: documented + test-enforced.** Source of truth is
  `docs/scheduling-algorithm.md` (priority; the `canChain` eligibility rule —
  universal 2h gap, NORMAL one-morning + one-afternoon, OT exempt from the cap;
  no-overlap on any car; >400 km co-driver). Leftovers the solver can't place get
  a `canChain`-gated recommendation (`placement-reco.ts`: fairest legal car → duty
  reclaim → co-driver for long trips) on the batch overflow list + the board queue. Read the
  doc before touching `lib/booking/*`.

### Earlier session deltas

- Email: bilingual TH/EN approval template + CTA + integration tests
- Dark mode wired app-wide via next-themes + theme toggle in header
- Calendar: density tint, count badge, conflict marker, vehicle filter
- Reporting: monthly buckets (was weekly) with locale-aware month names
- KPI cards: semantic colors (total/approved/cancelled)

## Open / pending

- **Production DB**: hosted by Chula IT — waiting on connection string.
  Local dev uses Homebrew Postgres 16 (`localhost:5432`, db `rent_car`).
- **LINE notifications**: scope confirmed driver-only. Code paths exist
  (`lib/line/client.ts`, webhook, assign-notify). Live channel needs
  interview answers: ownership, budget vs free-tier 500/mo, LIFF vs
  email-in-chat onboarding. See `memory/line_scope.md`.
- **Resend**: optional. `RESEND_API_KEY` empty -> console fallback.
  README §5 has the signup walkthrough.
- **Test residue**: the suite is **255 tests across 25 files**; most are pure
  unit tests, but a few `lib/booking/*.test.ts` (e.g. `actions.test.ts`) insert +
  delete fixture rows on the real dev DB. `scripts/seed-calendar-cluster.ts` injects 3
  same-day bookings on `today+7d` to demo the density tint and
  conflict marker — re-run safely, it wipes prior cluster-seed rows.

## Conventions

- HARNESS_PROTOCOL.md is the short rule sheet; full spec in
  `docs/harness-protocol-full.md`.
- Memory at the project's Claude auto-memory dir
  (`~/.claude/projects/<sanitized-cwd>/memory/`) is the source of truth for
  user preferences (DB plan, LINE scope, Thai vocab corrections).
- Matching/scheduling design + decision specs live in
  `docs/superpowers/specs/`; the simulation harness is the measurement
  instrument for that subsystem.
- Bilingual UI: Thai + English. Use next-intl `getLocale()` /
  `useLocale()` and `date-fns/locale/{th,enUS}` when formatting dates.

## Don't propose

- Migrating Postgres to Neon/Supabase/etc. Chula handles prod.
- LINE for requester/approver/admin — drivers only.
