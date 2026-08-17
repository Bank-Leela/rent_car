# Handoff — rent_car

What a fresh session needs to know before touching anything. The chronological
record of how we got here lives in [`docs/session-log.md`](docs/session-log.md) —
read it only when you need the history of a specific decision, not to start work.

## Where we are

Thai-language vehicle booking + dispatch for a Chulalongkorn medical faculty.
Feature-complete and in a pre-deployment hardening pass; **not yet deployed**.

- **Stack**: Next.js 16 (App Router, RSC, Server Actions), React 19, TypeScript
  strict, Prisma 5.22 + PostgreSQL, next-intl, Tailwind.
- **Verifier**: `make check` = typecheck + lint + test — the same three CI runs.
  Scheduling changes also need `make sim` (seven scenarios, exits non-zero on any
  rule violation). CI additionally runs `npm run build`.
- **Test suite**: 491 tests across 58 files.

## The invariants

Break one of these and the app is wrong in a way tests may not catch.

| Invariant | Where it lives |
|---|---|
| **car = driver** — every vehicle has one assigned driver (`Vehicle.assignedDriverId`) | `docs/scheduling-algorithm.md` |
| **No car is ever double-booked**, not even the duty (เวร) car. A manual override may relax only the 2h gap | same, plus the Postgres GiST constraint `vehicle_occupancy_no_overlap` |
| Priority **TJW → OT → WERN → NORMAL**; `canChain` needs a universal 2h gap; NORMAL capped at one morning + one afternoon; OT exempt from the cap, not the gap | `lib/booking/{batch-solver,driver-capacity}.ts` |
| Trips over **400 km** need a co-driver | `LONG_TRIP_KM` |
| Timezone is **Asia/Bangkok** and is scheduling-critical. `@db.Date` columns read back as UTC midnight — key them with `dbDateKey`/`driverDayKey`, never a local `startOfDay` | `lib/booking/db-date.ts` |
| **Thai-only UI** since 2026-08-05. One locale file, `messages/th.json`. next-intl resolves keys at **runtime**, so a missing key is a runtime failure no build can catch | `i18n/config.ts`, `tests/i18n-keys.test.ts` |
| Drivers are **passive and station-only** — P'Top makes every assignment; drivers sign in at a shared kiosk, never individually | — |
| Booking pipeline: `PENDING_APPROVAL`/`WAITLIST` → `AWAITING_DOCUMENT` → (document confirmed, runs จัด) → `APPROVED` → `ASSIGNED`. Side exits: `DENIED`, `CANCELLED`, `COMPLETED`, `OUTSOURCED` | `lib/booking/approval-actions.ts` |

## Open / pending

- **Deployment**: target decided — self-hosted **nginx + Linux + systemd**
  (`docs/deployment.md`). Not yet done: provision the box, set
  `/etc/rent_car.env`, pin `TZ=Asia/Bangkok`. Prod DB is hosted by Chula IT
  (connection string pending); local dev is Docker/Homebrew Postgres 16.
- **Gated integrations**, inert until their env var is set: Google Maps
  (`GOOGLE_MAPS_API_KEY`), daily batch cron (`CRON_SECRET`), Resend
  (`RESEND_API_KEY` empty → console fallback).
- **LINE notifications**: scope confirmed driver-only. Code paths exist
  (`lib/line/client.ts`, the webhook, assign-notify). A live channel needs
  answers on ownership, budget, and LIFF vs email-in-chat.
- **Signature**: the requester's own signature stamp shipped (`d82ca7c`) —
  `stampRequesterSignature` draws their registered image into the PDF via
  pdf-lib. Adobe Sign was removed in the same commit. The department head and
  driver still sign the printed copy by hand.
- **Test residue**: several `lib/booking/*.test.ts` insert and delete fixture rows
  on the real dev DB, so tests are not safe to run concurrently with each other
  or with a live session.

## Conventions

- `HARNESS_PROTOCOL.md` is the short rule sheet; the full spec is
  `docs/harness-protocol-full.md`. `AGENTS.md` owns the code-level rules
  (which files stay big, what the verifier is, where the scheduling truth lives).
- Scheduling design and decision specs live in `docs/superpowers/specs/`; the
  simulation harness (`scripts/simulate-cr07.ts`, `scripts/stress-scheduler.ts`)
  is the measurement instrument for that subsystem.
- User preferences, project decisions and external refs live in agent memory at
  `~/.claude/projects/<sanitized-cwd>/memory/`.

## Don't propose

- Migrating Postgres to Neon/Supabase/etc. Chula IT handles prod.
- LINE for requesters or admins — drivers only.
- Bringing back the APPROVER role. Removed by design; admins approve.
- Bringing back individual driver logins. Drivers sign in at the shared kiosk.
- Re-adding an English locale.
- Splitting the four big files `AGENTS.md` lists as deliberately whole.
- A cron for จัดรอบ — it stays a manual decision.
