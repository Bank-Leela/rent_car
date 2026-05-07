# Vehicle Booking System (rent_car)

Internal vehicle booking and management app for a Thai university faculty.
See `claude_code_implementation_plan.md` (lives on the user's machine) for the full
multi-phase plan; this README covers the **Phase 0** scaffold.

## Stack

- Next.js 16 (App Router) + TypeScript
- PostgreSQL via Prisma ORM
- NextAuth (Auth.js v5) with Google OAuth, restricted to `@chula.ac.th`
- Tailwind CSS + shadcn/ui
- React Hook Form + Zod
- date-fns, next-intl

## Local setup

### 1. Postgres

If you have Docker:

```bash
docker compose up -d
```

Otherwise run any local Postgres and update `DATABASE_URL`.

### 2. Environment

```bash
cp .env.example .env
# edit .env: AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
```

Generate a secret:

```bash
openssl rand -base64 32
```

Get Google OAuth credentials from the Google Cloud Console. Authorized redirect URI:
`http://localhost:3000/api/auth/callback/google`.

### 3. Database

```bash
npm run db:migrate -- --name init
npm run db:seed
```

The seed creates one user per role plus a sample department, driver, and three vehicles.
The four seeded users (`requester@`, `approver@`, `admin@`, `driver@chula.ac.th`) only
become real on first sign-in via Google — until then they're stub rows for local testing.

### 4. Dev server

```bash
npm run dev
```

Sign in at `http://localhost:3000/login` with a `@chula.ac.th` Google account. New users
get the `REQUESTER` role automatically; promote yourself to other roles via Prisma Studio
(`npm run db:studio`) for now.

## Repository layout

```
app/
  (admin)/        Administrator screens
  (approver)/     Department head screens
  (driver)/       Driver screens
  (requester)/    Requester screens
  api/
    auth/         NextAuth handlers
  login/          Sign-in page
auth.ts           NextAuth config
middleware.ts     Auth gate for non-public routes
components/
  app-shell.tsx   Shared layout chrome
  ui/             shadcn primitives
lib/
  db.ts           Prisma singleton
  auth-helpers.ts Server-side role guards
  line/client.ts  LINE notifier (stub for now)
prisma/
  schema.prisma   Data model (section 4 of the plan)
  seed.ts         Local dev seed
```

## Phase status

- [x] **Phase 0** — auth, schema, role-based routing
- [ ] Phase 1 — booking submission, admin queue, email notifications
- [ ] Phase 2 — approval flow + PDF
- [ ] Phase 3 — driver workflow
- [ ] Phase 4 — dashboard + reporting
- [ ] Phase 5 — recurring bookings, evaluation, LINE, polish
