# scripts/

One-off dev tools — simulation, demo seeding, and data maintenance. All run with
`npx tsx scripts/<name>.ts` against the **local dev DB** (except the pure
simulators, which need no DB). None are imported by the app or the test suite.

> Old phase-smoke scripts (`phase2-smoke`, `smoke-assign`, `eval-cycle-smoke`, …)
> were removed once the `vitest` suite (`lib/booking/*.test.ts`) superseded them.

## Simulation / verification (no DB)

| Script | Purpose |
|--------|---------|
| `simulate-cr07.ts` | Feeds synthetic daily batches through `solveDay()` and reports fairness + rule compliance. **The scheduling verification harness** — run the scenarios after any `lib/booking/*` change (see `AGENTS.md`): `npx tsx scripts/simulate-cr07.ts --scenario=<mixed\|normal\|ot\|tjw\|tight\|chain\|reclaim>` (rule-check counters must stay 0). |
| `simulate-driver-distribution.ts` | In-memory fairness fuzz: rotation + multi-day TJW carried across days; reports overflow-by-cause, fairness, utilization, TJW away-time. |

## Demo seeding (writes the dev DB)

| Script | Purpose |
|--------|---------|
| `seed-batch-demo.ts` | A realistic day for the batch UI demo (default: next Monday). Also exposed via the `/admin/batch` demo controls. |
| `seed-calendar-cluster.ts` | 3 bookings on one day so the calendar density tint + same-vehicle conflict marker have something to render. |
| `seed-free-driver-day.ts` | A day that has free drivers, so a board drag-drop lands a driver (green block) instead of driverless. |

## Data maintenance (writes the DB)

All dev-only except `reset-password.ts`, which is written to be safe on a live install.

| Script | Purpose |
|--------|---------|
| `ensure-fleet.ts` | Ensure the active vehicle/driver fleet exists without wiping demo data. |
| `pair-cars-drivers.ts` | Auto-pair active vehicles ↔ drivers 1:1 (`Vehicle.assignedDriverId`). Idempotent — fills only unpaired cars. |
| `backfill-booking-drivers.ts` | car=driver migration: set `primaryDriverId` to the vehicle's `assignedDriver` for future APPROVED/ASSIGNED bookings that have a vehicle but no driver. |
| `reconcile-overlaps.ts` | One-off fix for illegal car overlaps left by batch runs from before the no-overlap rule landed. |
| `reset-password.ts` | **Account recovery — safe on production.** Resets `passwordHash` + `mustChangePassword` and nothing else. Use instead of re-seeding when someone loses the password the seed printed: `db seed` also re-pairs every car to its seeded driver, silently undoing pairing work done in /admin/fleet. Defaults to `admin` alone; `--user=<username\|email>`, `--all`, `--dry-run`, `NEW_PASSWORD=…`. |

> The canonical seed is `prisma/seed.ts` (`npm run db:seed`) — departments, role
> users, and the 6 per-car driver logins (`driverA`–`driverF`). The scripts above
> layer scenario-specific data on top.
