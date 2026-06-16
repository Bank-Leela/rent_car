# Handoff — rent_car

Quick state snapshot for resuming work in a fresh session.

## Where we are

All 5 phases of `claude_code_implementation_plan.md` shipped.

### Latest session — matching/scheduling + slot/vehicle audit

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
  duty-car-only overlap; >400 km co-driver). Leftovers the solver can't place get
  a recommendation (`placement-reco.ts`: fairest free car → duty reclaim → plus a
  co-driver for long trips) on the batch overflow list + the board queue. Read the
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
- **Test residue**: `lib/booking/*.test.ts` insert + delete fixture rows
  on the real dev DB. `scripts/seed-calendar-cluster.ts` injects 3
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
