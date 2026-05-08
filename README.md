# Vehicle Booking System (rent_car)

Internal vehicle booking and management app for a Thai university faculty. All
five phases of `claude_code_implementation_plan.md` are implemented.

## Stack

- Next.js 16 (App Router) + TypeScript
- PostgreSQL via Prisma ORM (v5)
- NextAuth (Auth.js v5) with Google OAuth, restricted to `@chula.ac.th`
- Tailwind CSS + shadcn/ui (with @base-ui/react primitives)
- React Hook Form + Zod
- date-fns, next-intl, recharts
- @react-pdf/renderer for the request PDF
- Resend for email (console fallback when no API key)
- LINE Messaging API client (console fallback when no token)

## Local setup

### 1. Postgres

```bash
brew services start postgresql@16   # or `docker compose up -d`
```

### 2. Environment

```bash
cp .env.example .env
# edit .env: AUTH_SECRET (`openssl rand -base64 32`), GOOGLE_CLIENT_ID,
# GOOGLE_CLIENT_SECRET. The rest are optional.
```

Google OAuth: in the Google Cloud Console, add redirect URI
`http://localhost:3000/api/auth/callback/google`.

### 3. Database

```bash
npm run db:migrate
npm run db:seed
```

### 4. Dev server

```bash
npm run dev
```

Open <http://localhost:3000/login>. In dev mode, four "Dev impersonation"
buttons let you preview each role view without setting up Google OAuth.

## Phase status

- [x] **Phase 0** — auth, schema, role-based routing
- [x] **Phase 1** — booking submission, admin queue, email notifications
- [x] **Phase 2** — approval flow + signature upload + delegation + PDF
- [x] **Phase 3** — driver workflow (start/end trip, mileage)
- [x] **Phase 4** — dashboard + CSV export + dept usage view + print
- [x] **Phase 5** — recurring bookings, cancellation, evaluation, outsourcing, LINE

## Repository layout

```
app/
  (admin)/        Administrator screens (queue, dashboard, booking detail)
  (approver)/    Department head screens (inbox, profile, dept usage)
  (driver)/      Driver screens (today, assignment detail)
  (requester)/   Requester screens (list, new booking, detail)
  api/
    auth/        NextAuth handlers
    dev/         Dev-only impersonation (disabled in production)
    files/       Auth-gated PDF download
    line/        LINE webhook
    reports/csv/ CSV report exports
auth.ts          NextAuth config
proxy.ts         Auth gate
components/
  ui/            shadcn primitives
  forms/         All form components (booking, assign, approve, etc.)
  dashboard/     Charts + range filter
  app-shell.tsx  Shared layout chrome
lib/
  db.ts          Prisma singleton
  auth-helpers.ts, dev-auth.ts, session.ts
  booking/       Rules, schemas, server actions, recurrence
  email/         Resend client + templates
  line/client.ts LINE Messaging API client
  pdf/           react-pdf template + generator
  reporting/     Dashboard metric queries
  storage.ts     Local-disk file storage (signatures, PDFs)
prisma/
  schema.prisma  Data model (section 4 of the plan)
  seed.ts        Local dev seed
```

## Production deploy (Vercel + Neon)

The build script runs `prisma migrate deploy && next build`, so first deploy
sets up the schema automatically. `postinstall` runs `prisma generate`.

### One-time setup

1. **Neon Postgres** — sign up at <https://neon.tech>, create a project, copy
   the pooled connection string into Vercel env as `DATABASE_URL`.
2. **Google OAuth** — in Cloud Console, add the production callback URI:
   `https://YOUR-DOMAIN.vercel.app/api/auth/callback/google`.
3. **Vercel** — sign up at <https://vercel.com>, import the GitHub repo, set
   these env vars:

   | Var | Value |
   |---|---|
   | `DATABASE_URL` | Neon pooled connection string |
   | `AUTH_SECRET` | `openssl rand -base64 32` |
   | `AUTH_TRUST_HOST` | `true` |
   | `NEXTAUTH_URL` | `https://YOUR-DOMAIN.vercel.app` |
   | `GOOGLE_CLIENT_ID` | from Google Cloud |
   | `GOOGLE_CLIENT_SECRET` | from Google Cloud |
   | `RESEND_API_KEY` | optional — falls back to console logs |
   | `EMAIL_FROM` | `Vehicle Booking <noreply@yourdomain.com>` |
   | `LINE_CHANNEL_ACCESS_TOKEN` | optional |
   | `LINE_CHANNEL_SECRET` | optional |

4. After the first deploy, seed the database from your laptop:

   ```bash
   DATABASE_URL="<neon connection string>" npm run db:seed
   ```

### Caveats for v1 demo

- **PDF + signature storage is ephemeral on Vercel.** The runtime filesystem is
  read-only outside `/tmp`, and `/tmp` doesn't persist across instances. PDFs
  generated in one request may not be downloadable later. Move `lib/storage.ts`
  to Vercel Blob or S3 before going live to real users.
- **Dev impersonation is disabled in production** (`NODE_ENV !== "production"`
  gate). Real Google sign-in is required.
