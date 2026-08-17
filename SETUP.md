# rent_car — Setup (for first run)

Bilingual (TH/EN) vehicle-booking system. Next.js 16 + Prisma + PostgreSQL.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | **20.11–20.x** (not 21+) | https://nodejs.org or `nvm install 20` |
| npm | comes with Node | — |
| PostgreSQL | 16 | macOS: `brew install postgresql@16 && brew services start postgresql@16` |

> The app pins Node 20 (`engines` in package.json). Node 21+ will warn/fail.

## 1. Install dependencies

```bash
npm install
```

`postinstall` runs `prisma generate` automatically. `package-lock.json` is included, so this reproduces exact versions.

## 2. Database

The connection string lives in `.env` (`DATABASE_URL`). It points at a **local** Postgres named `rent_car` connecting as role `postgres`.

Create the role + database (one time):

```bash
# create a superuser role named "postgres" if your install doesn't have one
createuser -s postgres        # skip if it already exists
createdb rent_car
```

Apply the schema (uses committed migrations — does NOT need an interactive prompt):

```bash
npx prisma migrate deploy
```

Load demo data (departments, role users, 6 drivers + 6 vehicles paired car=driver):

```bash
npx prisma db seed
```

> If `DATABASE_URL` in `.env` doesn't match your local Postgres (different user/port/password), edit `.env` first.

## 3. Run

```bash
npm run dev
```

Open http://localhost:3000.

## Demo logins

Sign in at `/` — the site root *is* the sign-in screen, and `/login` just
redirects there — with **username or email + password** (the field is labeled
"Email or username"). All seeded accounts share one temporary password that
`prisma db seed` **prints once when it finishes** — it is generated per run and
is not stored anywhere, so copy it from that output. Every account is flagged
`mustChangePassword`, so you set a real one on first sign-in.

To choose the password yourself (scripted installs), set `SEED_PASSWORD` in the
environment before seeding.

| Role | Username | Email |
|------|----------|-------|
| REQUESTER | `requester` | requester@chula.ac.th |
| APPROVER | `approver` | approver@chula.ac.th |
| ADMIN ("P'Top") | `admin` | admin@chula.ac.th |
| DRIVERS (×6, car=driver) | `driverA` … `driverF` | driver@ and driver2@–driver6@chula.ac.th |

> The six driver logins are renamed to `driverA`–`driverF` by the seed (one per
> vehicle A–F); in dev, the "Preview as" buttons on `/` skip the password.

## Useful commands

```bash
npm run dev          # dev server
npm run build        # prod build (runs migrate deploy first)
npm test             # vitest unit + solver fuzz tests
npm run typecheck    # tsc --noEmit
npm run db:studio    # Prisma Studio — browse the DB
```

## Troubleshooting

- **`P1010` / role "postgres" denied** → run `createuser -s postgres`.
- **`prisma migrate dev` hangs** → use `npx prisma migrate deploy` (non-interactive).
- **Booking tests fail with unique-constraint races** → `npx vitest run --no-file-parallelism`.
- **Type errors after pulling** → `npx prisma generate`.
