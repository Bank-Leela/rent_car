# Handoff — rent_car

Quick state snapshot for resuming work in a fresh session.

## Where we are

All 5 phases of `claude_code_implementation_plan.md` shipped. Recent
session deltas:

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
- Memory at `~/.claude/projects/-Users-sushi-rent-car/memory/` is the
  source of truth for user preferences (DB plan, LINE scope, Thai
  vocab corrections).
- Bilingual UI: Thai + English. Use next-intl `getLocale()` /
  `useLocale()` and `date-fns/locale/{th,enUS}` when formatting dates.

## Don't propose

- Migrating Postgres to Neon/Supabase/etc. Chula handles prod.
- LINE for requester/approver/admin — drivers only.
