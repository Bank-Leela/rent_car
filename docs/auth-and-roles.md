# Authentication and roles

Sign-in is admin-provisioned username/password (Auth.js v5 Credentials,
`next-auth@5.0.0-beta.31`). There is no OAuth, no self-registration, and no
password column anywhere except `User.passwordHash`
(`prisma/schema.prisma:214`). This file is the map of who can reach what and how
the session gets made. Setup and first login are in [`README.md`](../README.md);
the env vars are in [`docs/deployment.md`](deployment.md).

## The three roles

`Role` is a three-value enum (`prisma/schema.prisma:15-19`) joined to `User`
through `UserRole` with `@@unique([userId, role])`
(`prisma/schema.prisma:248-255`), so the schema *can* hold several roles per
account.

| Role | Thai label | Reaches | Cannot |
|------|-----------|---------|--------|
| `REQUESTER` | ผู้ขอใช้รถ | `/requester/*`, `/account/*` | Anything under `/admin` or `/driver`; the official booking PDF |
| `ADMIN` | ผู้ดูแลระบบ | `/admin/*`, `/account/*`, every CSV report, every booking | — |
| `DRIVER` | พนักงานขับรถ | `/driver/*`, `/account/*` | Approve, assign, or file a booking |

(Labels: `messages/th.json:133-137`.)

One grant is *not* a role: `Department.headUserId`
(`prisma/schema.prisma:261-262`). The four file routes give the department head
the same access as an ADMIN to that department's bookings — PDF, attachment,
outsource quote. Nothing in the app writes `headUserId` and the seed leaves it
unset (`prisma/seed.ts:129-132`), so today the grant is dormant; setting it takes
direct database access.

**In practice every account holds exactly one role.** The create-user form is
deliberately single-select (`components/forms/create-user-form.tsx:20-27`) — the
data model allows more, but no screen is designed for a multi-role account.
Roles are written **only when the account is created**: by
`adminCreateUserAction` (`lib/auth/credentials-actions.ts:347`), by
`adminCreateDriverAction` (`lib/admin/driver-actions.ts:145`), and by the seed.
No screen and no action adds or removes a role on an existing account. Changing
someone's role means creating a new account or touching the database directly.

## Where you land, and what gates each area

`homePathFor` (`lib/auth-helpers.ts:29-35`) is the single precedence rule —
ADMIN, then DRIVER, then everything else:

| Roles | Lands on |
|-------|----------|
| `ADMIN` (with or without others) | `/admin` |
| `DRIVER` | `/driver/schedule` — the all-trips board, because the only driver login is the kiosk |
| anything else | `/requester/new` — the booking form, the primary action, not the list |

It is called from four places: after a successful sign-in
(`lib/auth/credentials-actions.ts:59`), from the site root (`app/page.tsx:8`),
from `/login` when an already-signed-in user opens it (`app/login/page.tsx:27`),
and for the account page's "back" link (`app/account/page.tsx:29`).

| Path | Gate | Enforced in |
|------|------|-------------|
| `/login`, `/forgot`, `/reset/*` | public | `proxy.ts:4` |
| `/` | signed in | `app/page.tsx:6-8` |
| `/account`, `/account/signature` | any signed-in user | `app/account/layout.tsx:26` |
| `/requester/*` | `REQUESTER` | `app/(requester)/layout.tsx:7` |
| `/driver/*` | `DRIVER` | `app/(driver)/layout.tsx:8` |
| `/admin/*` | `ADMIN` | `app/(admin)/layout.tsx:11` |
| `/api/auth/*` | public (Auth.js's own handler) | `proxy.ts:4` |
| `/api/dev/*` | non-production only | `lib/dev-auth.ts:12`, `app/api/dev/sign-in/route.ts:7` |
| `/api/cron/run-batch` | `Authorization: Bearer $CRON_SECRET`, timing-safe; 503 when the secret is unset | `lib/config/cron.ts:10-17`, `app/api/cron/run-batch/route.ts:26-29` |
| `/api/line/webhook` | LINE HMAC over the raw body, timing-safe; 503 when the secret is unset | `app/api/line/webhook/route.ts:21-32` |
| `/api/reports/csv/*` | session + `ADMIN`, else 403 | `app/api/reports/csv/[kind]/route.ts:41-45` |
| `/api/files/*` | session + a per-resource check | `booking-attachment/[id]/route.ts:24-30`, `signature/[userId]/route.ts:11-15` |

`/api/dev`, `/api/line` and `/api/cron` are in `PUBLIC_PATHS` too — the
middleware does not gate them at all, each route gates itself. And the match is
`startsWith`, not a segment match (`proxy.ts:15`): a new route whose path merely
*begins* with one of those strings is silently public.

A layout gate is not the whole story. A route group proves the *role*; the
*row* is checked separately — `/requester/[id]` refuses a booking that is not
yours (`app/(requester)/requester/[id]/page.tsx:63`), and `/driver/[id]` refuses
one you are not crewed on (`app/(driver)/driver/[id]/page.tsx:46-50`).

**`requireRole` redirects, it does not 403.** A REQUESTER who types `/admin`
goes to `/` (`lib/auth-helpers.ts:19` and `:25`), and `/` sends them to
`/requester/new`. Note the corollary: `homePathFor([])` returns `/requester/new`,
which the requester layout then bounces back to `/` — a user holding *no* role
would ping-pong. `adminCreateUserAction` refuses `roles.length === 0`
(`lib/auth/credentials-actions.ts:325`), which is the only thing preventing it.

`proxy.ts` is the middleware — Next 16 renamed `middleware.ts` to `proxy.ts`
(`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md:625`).
It is an optimistic pre-check only: it redirects unauthenticated requests,
deactivated users, and users on a temp password. Every page and action re-checks
server-side through `requireUser`. Do not move a gate *into* `proxy.ts` and
delete the one in the action.

## The shared driver kiosk

Drivers are passive. P'Top decides every assignment; there is no draft board, no
claim flow, and in practice no individual driver login. All drivers share one
kiosk account on one device in the garage.

The kiosk is identified by a **positive email allowlist**, not by "a DRIVER with
no `Driver` profile" (`lib/auth/station.ts:1-17`). That distinction is the whole
point of the file: a freshly-created driver who has not been provisioned yet,
and any hypothetical ADMIN+DRIVER account, are *also* profile-less and must not
inherit kiosk powers over other drivers' trips.
`tests/station-trip.test.ts:141` is the regression test for exactly that.

```
DRIVER_STATION_EMAILS   comma-separated, lowercased
                        default: driverstation@chula.ac.th
```

| Capability | Kiosk | An individual driver account |
|-----------|-------|------------------------------|
| Nav | `/driver/schedule` + `/driver/calendar` only | also `/driver` (Today) — `lib/nav/role-nav.ts:23-34` |
| `/driver` | redirected to `/driver/schedule` — it has no personal "today" (`app/(driver)/driver/page.tsx:20`) | own trips for the day |
| `/driver/calendar` | the whole fleet's month (`app/(driver)/driver/calendar/page.tsx:67-71`) | own month |
| Trip drawer detail | any booking (`lib/booking/station-actions.ts:65`, `:86-90`) | APPROVED, or own/claimed |
| Start / end a trip | any booking (`lib/booking/driver-actions.ts:67-83`) | only trips it is crewed on |
| Open the official PDF | yes — the driver carries the printed form for the passenger's signature (`app/api/files/booking-pdf/[id]/route.ts:65-83`) | only its own trips |

`/driver/schedule` itself is the whole day's board for *any* DRIVER, kiosk or
not (`app/(driver)/driver/schedule/page.tsx:24`); the kiosk difference is that
it has nothing else.

Two independent code paths compute "is this the station", and both additionally
require `isActive` (`lib/booking/station-actions.ts:65`,
`lib/booking/driver-actions.ts:73`). The requester is deliberately **not**
granted the PDF — it is the transport office's paperwork, and the URL is
guessable from a booking id the requester already has.

## Sign-in mechanics

`auth.ts` is the whole configuration. One `Credentials` provider, one
`authorize` function (`auth.ts:53-123`).

- **Identifier is username OR email.** Lowercased and trimmed, then matched with
  `OR: [{ email }, { username }]` (`auth.ts:88-93`). Both are `@unique`;
  `username` is nullable, and an account without a `passwordHash` cannot sign in
  at all (`auth.ts:95`).
- **Sessions are JWT** (`auth.ts:41`). Not a choice about scale: the credentials
  flow creates no OAuth `Account` row, so the Prisma session strategy would have
  nothing to key on and would be a no-op. No adapter is configured, so the
  `Account`, `Session` and `VerificationToken` tables
  (`prisma/schema.prisma:145,164,172`) are unused. The token carries `uid`,
  `roles`, `isActive`, and `mustChangePassword`, so `proxy.ts` and every server
  action can gate without a DB round-trip.
- **The token refreshes from the DB on every subsequent request**
  (`auth.ts:139-151`). A role change or a deactivation therefore takes effect on
  the next request rather than at token expiry. `session.maxAge` is not
  configured anywhere — Auth.js's default applies.
- **`trustHost: true` is pinned** (`auth.ts:31-40`). Behind nginx the request
  Host is a proxy header, so Auth.js would resolve `trustHost=false` under
  `NODE_ENV=production` and answer *every* `/api/auth/*` request with
  `UntrustedHost` — nobody could sign in at all. Safe because nginx is the only
  thing that can reach `127.0.0.1:3000`.
- **`mustChangePassword` blocks the app.** `proxy.ts:37-44` redirects to
  `/account?forceChange=1`; only `/account` and `/api/auth` are exempt
  (`proxy.ts:8`), so signing out is the one escape that does not defeat the lock.
  This lock lives **only** in `proxy.ts` — no helper in `lib/auth-helpers.ts`
  checks the flag. `?forceChange=1` is a *label on the redirect, not authority*
  — the account page and its layout read the real flag off the row and
  additionally exempt dev impersonation (`app/account/layout.tsx:47-48`,
  `app/account/page.tsx:47-54`). Changing the password to the same value is
  refused, or the admin-issued password would stay live while the account read
  as "has chosen their own" (`lib/auth/credentials-actions.ts:101-103`).
- **Login throttle** — `lib/login-throttle.ts:26-31`, in-memory, single process:

  | | |
  |---|---|
  | Failures before lockout | 8 |
  | Window | 15 min |
  | Lockout | 15 min |
  | Keyed on | `id:<identifier>` **and** `ip:<client ip>`, whichever trips first |
  | On success | clears the identifier only — one correct sign-in must not reset an address mid-sweep (`auth.ts:110-112`) |

  It refuses **before** the DB hit and before bcrypt (`auth.ts:78-86`): the point
  is not to spend the work, not merely to reject the answer. The same limiter is
  reused for password-reset mail under a `reset:<email>` key
  (`lib/auth/credentials-actions.ts:215-217`), so 8 reset requests per address
  per 15 minutes.

  It lives in memory on purpose — one self-hosted Node process sees every
  attempt. Run this multi-instance and the effective limit multiplies by the
  instance count; that is the point at which it moves to Postgres or Redis.

- **Username may be changed once, by the user**
  (`lib/auth/credentials-actions.ts:143-145`, `usernameChangedAt`). After that
  nothing in the app can change it: `changeUsernameAction` is the only code path
  that writes `username` after creation (`:161`), and there is no admin
  username screen — despite what the Thai copy (`messages/th.json:76`) and the
  schema comment (`prisma/schema.prisma:192-193`) both promise. A second change
  needs direct database access. Password rotations have no such limit. Email
  never changes — it is the recovery path.
- **Dev impersonation** (`lib/dev-auth.ts`) sets a `dev_user_id` cookie from a
  bare user id and `getSession()` prefers it over real auth (`lib/session.ts:4-8`).
  It is gated on `NODE_ENV !== "production"` with **deliberately no env escape
  hatch** — a single flag on the production host would turn it into
  credential-free impersonation of any account including ADMIN. `proxy.ts:10-11`
  still honours a legacy `ENABLE_DEV_AUTH=true`, but only to let a request past
  the middleware gate; `getDevSession()` returns `null` in production, so
  `requireUser` bounces it to `/login` anyway. Do not add that flag to
  `lib/dev-auth.ts`.

## How accounts come to exist

There is no sign-up. There are two creation paths:

- **A login.** An ADMIN creates it at `/admin/users` (`adminCreateUserAction`,
  `lib/auth/credentials-actions.ts:312-352`) with an initial password and
  `mustChangePassword: true`.
- **A roster identity, not a login.** `/admin/drivers` creates a DRIVER-role
  `User` with a synthetic `@fleet.invalid` email, no username and no
  `passwordHash` (`adminCreateDriverAction`, `lib/admin/driver-actions.ts:126-148`).
  It exists to hold a name and phone for dispatch and can never sign in. Removing
  a driver deletes that user outright when it has no trip history, and otherwise
  deactivates it (`:203-214`).

| Situation | Do this |
|-----------|---------|
| First install | `npx prisma db seed` — creates `requester@`, `admin@`, `driverstation@` (`prisma/seed.ts:90-97`) plus the six fleet drivers (`:143-186`), all with `mustChangePassword` |
| Seed password | `SEED_PASSWORD` if set (must be ≥ 8 chars or the seed refuses and writes nothing, `prisma/seed.ts:24-30`), otherwise a random 24-char value **printed once** at the end (`prisma/seed.ts:263-279`) and never stored in plaintext |
| After seeding a real install | All nine seeded accounts share that one password — including the six fleet-driver logins, which the station-only model says nobody uses. Reset or deactivate them |
| A user forgot their password | Admin resets it at `/admin/users` (`adminResetPasswordAction`, `lib/auth/credentials-actions.ts:359-376`); the new password forces a change on next sign-in |
| Self-service | `/forgot` → sha256-hashed token, 1 h TTL, single-use (`lib/auth/credentials-actions.ts:200-288`). Needs `RESEND_API_KEY` — see below |
| Lost the admin password | `npx tsx scripts/reset-password.ts` — defaults to `admin@chula.ac.th` alone and touches only `passwordHash` and `mustChangePassword`. Re-running the seed would also work but re-pairs every car to its seeded driver, silently undoing pairing done through `/admin/fleet` |
| One user | `scripts/reset-password.ts --user=<username\|email>`; `--all` for everyone, `--dry-run` to preview, `NEW_PASSWORD=…` to choose the password |

**`/forgot` is silent when mail is not configured.** Delivery is Resend, not
SMTP: without `RESEND_API_KEY` the send is suppressed with a log line and the
action still returns success (`lib/email/client.ts:16-35`) — deliberately, since
returning anything else would turn the form into an account-existence probe. The
link's host comes from `PUBLIC_BASE_URL` → `APP_URL` → `NEXTAUTH_URL` →
`http://localhost:3000` (`lib/auth/credentials-actions.ts:236-241`), so an
unset trio mails out a localhost link.

`adminToggleActiveAction` refuses the two moves that nobody inside the app could
undo — deactivating yourself, and deactivating the last active admin
(`lib/auth/credentials-actions.ts:397-416`). Recovering from either needs direct
database access, which the office does not have.

## Security decisions worth knowing before you change them

**`AUTH_SECRET` never appears in application code.** Grepping the repo finds it
only in `.env.example`, the README, `docs/deployment.md`,
`deploy/rent-car.service.sample`, and CI. Auth.js reads it internally. If it is
missing, sign-in fails with the ordinary "wrong credentials" message and no
other symptom — check it first when a known-good password is rejected
(`README.md:455-456`).

**The throttle keys on `X-Real-IP`, not the leftmost `X-Forwarded-For`**
(`auth.ts:58-74`). `deploy/nginx.conf.sample:43` uses
`$proxy_add_x_forwarded_for`, which **appends** `$remote_addr` to whatever the
client sent — so the leftmost segment is attacker-written. Keying on it meant a
fresh header per attempt landed in a fresh bucket and the per-IP cap never once
fired, and someone else's bucket could be spent by forging their address.
`X-Real-IP` is `$remote_addr` from the same config (line 42) and the client
cannot influence it; the *last* XFF segment is nginx's own append and is the
fallback. Do not "simplify" this back to `xff.split(",")[0]`.

**The anti-enumeration dummy hash must keep bcrypt cost 12.** A miss or a
disabled account still runs `compare(password, DUMMY_HASH)` so it costs the same
time as a wrong password (`auth.ts:95-103`). The constant is cost 12
(`auth.ts:20`) because stored hashes are cost 12 (`BCRYPT_ROUNDS`,
`lib/auth/credentials-actions.ts:16`; also `prisma/seed.ts:35` and
`scripts/reset-password.ts:82` — four places that must stay in step). It was
once 10 against stored 12: four times less work, so "no such user" returned
measurably faster and leaked exactly the fact the branch was written to hide.

**Server actions are callable whether or not their button rendered.** Hiding a
control is not a guard — `lib/booking/demo-guard.test.ts:18-29` exists because
two demo controls were gated on `requireRole("ADMIN")` alone, and ADMIN is the
role that runs the real office. They now also require `isSimulationEnabled()`
(`lib/booking/batch-demo-actions.ts:230,271`), which is off in production unless
`ENABLE_SIMULATION=true` (`lib/config/features.ts:6-9`).

## Gating a new server action

Start with the right helper (`lib/auth-helpers.ts`). All three redirect rather
than throw, and all three enforce `isActive` — a user deactivated mid-session
holds a live JWT, so `requireUser` is the single choke point that catches them
(`lib/auth-helpers.ts:8-13`, asserted in `tests/auth-helpers.test.ts`).

| Helper | Use when |
|--------|----------|
| `requireUser()` | any signed-in user; you will check ownership yourself |
| `requireRole(role)` | exactly one role may call this |
| `requireAnyRole(roles)` | several may |

Then, if the action can act on someone else's data, check the row too. The
pattern to copy is `cancelBookingAction` (`lib/booking/extra-actions.ts:49-52`):
`requireUser`, then `booking.requesterId !== userId && !isAdmin → refuse`.

### The zod-strip trap

`z.object` runs in **strip** mode. An undeclared `FormData` key is dropped
silently — so a field the client faithfully submits arrives as `undefined` and
the feature looks broken with nothing to debug. That pushes you to declare it.
But **declaring it is not gating it.** Reaching the schema proves only that the
key was sent.

This is how `jobType` became a privilege hole. It was declared in
`newBookingSchema`, survived the strip pass, and the create action read
`data.jobType ?? classify(...)` — a *submitted* value beat the classifier.
Posting `jobType=TJW` put an ordinary errand at the head of the priority order
and let it pull the duty car. The schema's own comment
(`lib/booking/schema.ts:103-106`) already said the requester no longer picks it;
only the code disagreed.

The fix is the shape to copy — gate on the **role**, in the action:

```ts
// lib/booking/create-booking-action.ts:84
const requestedJobType = isAdmin || data.jobType === "SMUS" ? data.jobType : undefined;
```

`travelWithinChula` got the same treatment on line 90: §5c made it the flag that
decides whether Postgres will let two bookings share a car, so a requester
ticking it alongside `outOfProvince` could switch off the no-double-book
backstop. It is now derived, not trusted.

The admin-only fields (`onBehalfOfUserId`, `backdated`, `actualDriverId`) are
grouped under an explicit comment in `lib/booking/schema.ts:127-131` saying the
schema parses them off *any* payload and the action is what enforces the role —
`lib/booking/create-booking-action.ts:45-50`. Keep that comment with any field
you add there, and add the role check in the same commit.
