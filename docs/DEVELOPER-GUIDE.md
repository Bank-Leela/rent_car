# rent_car — Developer Guide

How this codebase is put together, for someone who has to change it.

`docs/PROJECT-OVERVIEW.md` explains **what the system does** (roles, domain,
booking lifecycle, scheduling rules). This document explains **how it is built** —
the patterns you must follow, where things live, and the traps that have bitten
people before. Read the overview first if the domain is new to you.

**Verified against commit `9861a48` (2026-08-10).** Where the older docs disagree
with the code, §9 lists the corrections.

---

## 1. Run it locally

```bash
nvm install 20 && nvm use 20      # engines pins >=20.11 <21 — Node 21+ is refused
npm ci                            # postinstall runs `prisma generate`
createuser -s postgres; createdb rent_car
npx prisma migrate deploy         # 50 migrations, non-interactive
npx prisma db seed                # prints a temp password ONCE — copy it
npm run dev                       # http://localhost:3000/login
```

`DATABASE_URL` lives in `.env` (not committed). In dev, `/login` shows
"Preview as" buttons that skip the password.

One environment variable is not optional anywhere, including your laptop if you
touch scheduling: **`TZ=Asia/Bangkok`**. See §9.

---

## 2. The shape of a request

```
browser
  └─ Next.js App Router  (React Server Components, Turbopack)
       ├─ proxy.ts ............. auth gate, runs before every non-static route
       ├─ app/(group)/layout.tsx  role gate + nav chrome
       ├─ page.tsx ............. Server Component: queries Prisma directly
       └─ "use client" island .. interactive bits only
            └─ server action ... the mutation path ("use server")
                 └─ prisma ..... PostgreSQL
```

There is no service layer and no REST API for mutations. A page is a server
function that queries the database; a form posts to a server action that writes
to it. Anything that adds indirection between those two is fighting the codebase.

---

## 3. Frontend

### 3.1 Route groups

Three parallel apps under `app/`, one per role:

| Group | Audience | Gate (in its `layout.tsx`) |
|---|---|---|
| `app/(admin)/` | ADMIN — P'Top | `requireAnyRole(["ADMIN"])` |
| `app/(driver)/` | the shared garage kiosk | driver-station gate |
| `app/(requester)/` | staff requesting a car | `requireRole("REQUESTER")` |

Auth is enforced **twice, deliberately**: `proxy.ts` redirects unauthenticated
traffic before rendering, and each layout re-checks the role server-side. Never
rely on the middleware alone — it is a redirect, not an authorization boundary.

Each layout also builds the nav and wraps children in `<AppShell>`. To add a page
to a role's nav, add an entry to that group's `layout.tsx` `nav={[...]}` array.

### 3.2 Server by default, client by exception

28 `page.tsx` files, 75 files marked `"use client"`. Pages are Server Components:
they `await prisma...` directly, then pass plain data down. A component becomes a
client component only when it needs state, effects, or event handlers — and then
it receives data as props rather than fetching.

The convention when a page needs both: page does the query, then hands rows to a
`*-client.tsx` component. `app/(requester)/requester/page.tsx` →
`components/requester-history-client.tsx` is the model to copy.

### 3.3 Forms

`react-hook-form` + `zod` on the client, and **the same shape re-validated with
zod inside the server action**. Client validation is UX; the server action's
`safeParse` is the real gate. Actions return `{ ok: true } | { ok: false, error, field? }`
so the form can render the message inline — they don't throw for user error.

### 3.4 Filters and URL state

Filtering happens client-side over already-loaded rows, with the filter state
mirrored into the URL via `history.replaceState` so a view is shareable without an
RSC round-trip. `requester-history-client.tsx` shows the pattern, and the pure
`filterHistory()` function is exported separately so it can be unit-tested.

### 3.5 i18n — Thai only, and it throws

`next-intl`, single locale, `messages/th.json` (`i18n/request.ts` resolves one
locale and does no negotiation). **A missing key throws at render.** Adding a
status, job type, or filter chip without adding its message key crashes the page
that renders it — so when you extend an enum, grep `messages/th.json` for the
sibling keys and add yours in the same pass.

Dates in the Thai UI are Buddhist-era. Use the existing helpers rather than
formatting inline.

### 3.6 UI kit

Tailwind v4 + shadcn/ui built on `@base-ui/react` primitives, in `components/ui/`.
Compose with the `cn()` helper from `lib/utils`. Before writing a new input,
check `components/ui/` — `PasswordInput` (a password field with a show/hide eye)
existed for a while before anyone noticed and wired it into the login form.

---

## 4. Backend

### 4.1 Server actions are the API

22 files carry `"use server"`. Mutations are server actions, grouped by domain in
`lib/booking/*-actions.ts` (`approval-actions`, `matching-actions`,
`fleet-actions`, `driver-actions`, `availability-actions`, …).

An action's standard sequence:

1. `requireRole(...)` / `requireUser()` — authorize **first**, always
2. `zod.safeParse` the `FormData`
3. do the work through `prisma`
4. write an `AuditLog` row for anything a human would ask "who did this?" about
5. `revalidatePath(...)` the affected routes
6. return `{ ok }` — or `redirect()`, which must be **outside** any `try/catch`
   (it works by throwing)

### 4.2 API routes are the exception

Only 10 `route.ts` files exist, for things a server action genuinely cannot do —
they need a URL:

| Route | Why it's a route |
|---|---|
| `api/auth/[...nextauth]` | Auth.js handler |
| `api/files/booking-pdf/[id]` | returns a PDF stream, auth-gated |
| `api/files/{signature,booking-attachment,outsource-quote}/…` | auth-gated binary |
| `api/reports/csv/[kind]` | file download |
| `api/cron/run-batch` | called by a systemd timer, bearer-auth |
| `api/line/webhook` | inbound from LINE |
| `api/dev/sign-in`, `api/dev/sign-out` | dev impersonation, hard-gated off in prod |

Don't add a route for something a form can call directly.

### 4.3 Data access

`lib/db.ts` exports one `prisma` singleton (cached on `globalThis` in dev so
hot-reload doesn't exhaust the connection pool). Import it; never construct a
`PrismaClient`. There is no repository or DAO layer — pages and actions query
Prisma directly, and shared query shapes live in small modules like
`lib/booking/booking-detail-include.ts`.

### 4.4 Auth

Auth.js v5, Credentials provider, **JWT sessions** (`auth.ts`). Accounts are
admin-provisioned; there is no OAuth and no self-registration.

Two details that matter:

- `trustHost: true` is hardcoded, because behind nginx the Host is a proxy header
  and Auth.js would otherwise reject every `/api/auth/*` call with `UntrustedHost`.
- The `jwt` callback **re-reads `roles`, `isActive` and `mustChangePassword` from
  the database on every request**. Role changes and deactivations take effect
  immediately without forcing a re-login — but it also means every request costs
  one extra query.

`proxy.ts` additionally bounces anyone with `mustChangePassword` to
`/account?forceChange=1` until they rotate it.

### 4.5 Audit log

`lib/booking/audit.ts`. Historically every row belonged to a booking; since
migration `20260810120000_audit_non_booking_events`, `bookingId` is nullable and
non-booking events (marking a driver off, swapping a เวร day, re-pairing a car)
carry `entityType` + `entityId` instead.

### 4.6 Files

`lib/storage.ts` writes to local disk under `UPLOADS_DIR` — signatures, booking
attachments, outsource quotes. **Not in the database**, so a backup that only
dumps Postgres is not a backup. Files are served through auth-gated API routes,
never as static assets.

### 4.7 PDF

`lib/pdf/official-form.ts` fills the real faculty AcroForm
(`public/2 แบบฟอร์ม…e.pdf`, 57 fields) using **pdf-lib** + an embedded Noto Sans
Thai face, rendered live on download. `bookingToFormFields` is pure and unit-tested
— test the mapping there, not by eyeballing a PDF.

### 4.8 Scheduling

The largest and most volatile part of the system: 84 files in `lib/booking/`.
**`docs/scheduling-algorithm.md` is the source of truth** — read it before
touching `rotations`, `batch-solver`, `matching`, `leave-core`,
`availability-actions`, or `driver-rounds`. `AGENTS.md` lists the exact hotspots.

Verify scheduling changes two ways:

```bash
npx vitest run --no-file-parallelism            # canChain, solver-invariants, overtime-reco
npx tsx scripts/simulate-cr07.ts --scenario=mixed   # rule-check counters MUST stay 0
```

---

## 5. Data model

24 models, 13 enums, 50 migrations (`prisma/schema.prisma`). The ones you'll meet
first: `User` + `UserRole` (a user may hold several roles), `Booking`, `Trip`,
`Driver`, `Vehicle`, `Department`, `OnCallShift`, `Evaluation`, `AuditLog`.

**car = driver.** `Vehicle.assignedDriverId` is 1:1 and unique. Choosing the
driver *is* choosing the car; a driver without a car cannot be dispatched.

**The database enforces the no-double-book rule itself.** Migration
`20260701120000_vehicle_occupancy_no_double_book` maintains a `VehicleOccupancy`
table via trigger and puts a GiST `EXCLUDE` constraint on it, so overlapping
intervals for one vehicle are rejected at the database. Application bugs surface
as a `23P01` error rather than as a double-booked car. That constraint needs the
`btree_gist` extension, and it hardcodes `Asia/Bangkok` to mirror
`lib/booking/trip-legs.ts` — which is why §9's timezone rule is not negotiable.

---

## 6. Adding a feature, end to end

Say you're adding a field to a booking:

1. `prisma/schema.prisma` — add the field; `npx prisma migrate dev --name <what>`
2. `npx prisma generate` (automatic on `npm ci`)
3. Add it to the zod schema and the form component
4. Handle it in the server action; write an `AuditLog` row if a human would ask who changed it
5. Add any new label to `messages/th.json` — **a missing key throws**
6. Render it (server component reads it; client island only if interactive)
7. `npm run typecheck && npx vitest run --no-file-parallelism`
8. If it touches scheduling, run the simulator and keep the counters at 0

---

## 7. Testing

43 test files, ~372 tests, `vitest`, `fileParallelism: false` (DB-backed tests
collide on unique keys otherwise — always use `make test` or the flag).

Two kinds live side by side:

- **Pure unit tests** — rules, `canChain`, fairness, form-field mapping, filters.
  No database. These are the ones to add for new logic; keep logic pure enough to
  test this way.
- **DB-backed tests** — they create and `deleteMany` real rows. They need a
  `DATABASE_URL` and **must never point at a production database.**

```bash
make check   # typecheck + lint + test — the gate
make sim     # scheduling scenario check
```

---

## 8. Deployment

`docs/deployment.md` is the generic guide. For the box this is actually running
on — including four deliberate deviations from that guide — see
`~/rentcar-deploy/RUNBOOK.md` on the server.

Upgrade loop:

```bash
git pull && npm ci
set -a; source /etc/rent_car.env; set +a
TZ=Asia/Bangkok npm run build      # runs `prisma migrate deploy` first
sudo systemctl restart rent-car    # REQUIRED
```

The restart is not optional, and not only because of Prisma's cached client:
`next build` **deletes the previous build's chunks**, so between build and
restart the running process serves HTML pointing at JavaScript files that no
longer exist, and every visitor gets 500s on those assets. The page shell loads
and the app appears broken in ways that look like application bugs.

---

## 9. Traps

**`TZ=Asia/Bangkok` or scheduling silently corrupts.** Day boundaries (จัดรอบ)
and no-wait leg splits are computed in server-local time, and the database
occupancy constraint hardcodes Bangkok. In production `instrumentation.ts`
**throws `[TZ FATAL]` and refuses to boot** on a wrong zone; in dev it only warns.
Set the host zone too — systemd timers resolve `OnCalendar=` against the host.

**Never re-run `prisma db seed` on a live install.** It re-pairs every car to its
seeded driver, silently undoing pairing work done in `/admin/fleet`. To recover a
lost password use `scripts/reset-password.ts`, which writes only `passwordHash`
and `mustChangePassword`.

**A missing `messages/th.json` key throws at render.** Extending an enum without
extending the messages crashes the page.

**Demo seeders are dev tools.** Everything in `scripts/` except
`reset-password.ts` assumes a disposable database; several clear their target
day's bookings.

**`@react-pdf/renderer` is still in `package.json` but unused** — the PDF path is
pdf-lib. Don't follow it as an example.

### Where the older docs have drifted

| Doc says | Actually |
|---|---|
| PostgreSQL 16 | schema needs nothing beyond **PG 12+**; production runs **14** |
| `messages/{en,th}.json`, bilingual UI | **`th.json` only** — Thai-only |
| PDF via `@react-pdf/renderer` | **pdf-lib** (`lib/pdf/official-form.ts`) |
| 18 models / 12 enums / 17 migrations | **24 / 13 / 50** |
| `lib/booking/*` ~34 files | **84** |
| `EvaluationRating` enum | `Evaluation.rating` is an **Int, 1–5 stars** |
| APPROVER role | **removed** — `Role` is `REQUESTER \| ADMIN \| DRIVER` |
| Adobe Sign integration | **removed**; replaced by the requester signature stamp |

---

## Document index

| Read when | Document |
|---|---|
| New to the domain | `docs/PROJECT-OVERVIEW.md` |
| Touching assignment logic | `docs/scheduling-algorithm.md` — **mandatory** |
| Building it | this document |
| First local run | `SETUP.md` |
| Deploying | `docs/deployment.md`, `RUNBOOK.md` |
| Recent history / why something is the way it is | `HANDOFF.md` |
| Agent/automation rules | `AGENTS.md`, `HARNESS_PROTOCOL.md` |
