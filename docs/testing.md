# Testing

How to prove a change here is correct, and which harness proves what. Install and
first-run are in [`README.md`](../README.md); the dispatch rules themselves are
in [`docs/scheduling-algorithm.md`](scheduling-algorithm.md).

## The gate: `make check`

`make check` is `typecheck + lint + test` (`Makefile:9`) — the same three CI
runs. Run it after any `.ts` / `.tsx` change.

| Step | Command | Catches |
|---|---|---|
| `typecheck` | `tsc --noEmit` | types; Prisma model drift (run `npx prisma generate` first after a pull) |
| `lint` | `eslint`, flat config in `eslint.config.mjs` — `eslint-config-next` core-web-vitals + typescript | unused vars, React hook rules, Next-specific pitfalls |
| `test` | `npx vitest run --no-file-parallelism` (`Makefile:18`) | everything in [The classes of test](#the-classes-of-test) |

**Lint is part of the gate.** For a while `check` ran lint and CI did not, so
lint breakage reached main unseen (`Makefile:5-8`). If you change one list,
change the other.

None of the three compiles the RSC/client boundary. A Server Component passing a
non-serializable prop, or a bad `next.config`, passes tsc *and* eslint and fails
only in `next build` — which is why CI runs that too. Note that `npm run build`
is `prisma migrate deploy && next build` (`package.json:10`): running it locally
applies pending migrations to whatever `DATABASE_URL` points at.

`make sim` is **not** in `make check`. CI runs it separately; so should you.

## What CI runs

`.github/workflows/ci.yml`, in order, against a `postgres:16` service container:

| Line | Step | Why it is there |
|---|---|---|
| 45–47 | `prisma generate` / `migrate deploy` / `db seed` | the DB-backed tests need real schema and real seed rows |
| 48–49 | `tsc --noEmit`, `npm run lint` | the first two thirds of `make check` |
| 52 | `npm test` | serialized by config, not by flag — see below |
| 58 | `make sim` | the scheduling gate |
| 64 | `npm run build` | the only step that compiles the RSC/client boundary |

Two pins that matter: `TZ: Asia/Bangkok` (`ci.yml:34`), because scheduling
computes day boundaries in *server-local* time and a UTC runner disagrees with
production; and Node `20.11` (`ci.yml:41`).

## `make sim` — the scheduling scenario gate

`make sim` runs `scripts/simulate-cr07.ts` over all seven scenarios in sequence
(`Makefile:35-39`), 60 simulated days each at seed 42 (the script's defaults,
`simulate-cr07.ts:32-33` — `make sim` passes only `--scenario`). Each day is fed
through the real `solveDay()`.

| Scenario | Stresses |
|---|---|
| `mixed` | random NORMAL / OT / TJW / WERN, some >400 km |
| `normal`, `ot` | one job type only; `ot` sits on the 08:00 / 16:00 cutoffs |
| `tjw` | drivers locked away on multi-day trips |
| `tight` | 11 cases/day — the daily ceiling (5 fresh drivers × 2 + 1 duty, `:4-7`), forces FCFS overflow |
| `chain` | same-day morning + afternoon chains for every driver |
| `reclaim` | thin staffing + a >400 km OT, to trigger `NEEDS_WERN_RECLAIM_DECISION` |

Three counters must stay 0 (`simulate-cr07.ts:398-401`):

| Counter | Rule it checks |
|---|---|
| `2/day cap violations` | the NORMAL cap is *one morning + one afternoon*, not "at most two" — checked with the solver's own `endsByNoon` / `startsAfterNoon` predicates rather than a restatement of them (`:355-363`) |
| `2h buffer violations` | the universal 2-hour gap, and no per-driver overlap, over every pair in a driver's day (`:364-375`) |
| `duty driver doing extra work` | the WERN duty driver appearing in a non-WERN lineup (`:377-386`) |

Nonzero prints `FAILED` and exits 1 (`:471-479`) — deliberately *after* the whole
report, so a failing run still shows the per-driver totals. It used to exit 0 no
matter what the counters said, which made the "gate" a human squinting at stdout.

### The counters measure legality, not fairness

This is the single most important caveat in this document. The counters check the
gap, the cap, and overlap. **They say nothing about who got the work.**

The solver never applied the provisional rotation bump that
`docs/scheduling-algorithm.md` §6 has always claimed it did, so within one solve
`rankForCategory` kept sorting on unchanged stamps and the same driver stayed at
the head of the queue: put three OTs on a day and one driver took all three.
Three OTs two hours apart are perfectly legal and perfectly unfair — every
counter stayed 0 and CI stayed green over it (fixed in `2023ec2`; see
`docs/session-log.md`).

The script *prints* `fairness : mean … stddev … spread` (`:419`) but nothing
asserts on it. To prove a fairness or rotation-order change: drive `solveDay()`
directly in a test and assert who received what, and compare that fairness line
across all seven scenarios before and after — the fix above moved stddev in four
of seven and moved no counter.

## The classes of test

63 `*.test.ts` files. Vitest collects `lib/**`, `tests/**` and `components/**`
(`vitest.config.ts:7`) in the `node` environment (`:6`) — there is no jsdom, so
nothing renders React. Component *logic* is tested by extracting it to a plain
function (`components/list-search.test.ts` against `filterRows`, exported from
`components/list-search.tsx`).

### Pure unit tests (40 files)

The rules as functions, no I/O: `rotations.test.ts` (`canChain`, the gap, the
cap, `sharesCarWith`), `classification.test.ts`, `overtime-reco.test.ts`,
`trip-legs.test.ts`, `batch-solver.test.ts`.

`solver-invariants.test.ts` is the property/fuzz test — many random days through
the real solver via `lib/booking/simulation.ts`, asserting the full rule set on
every day including multi-day TJW carried across days.
`scripts/stress-scheduler.ts` is the larger version of the same idea (a matrix of
driver counts × `longTjwProb` × seeds, 400 days each by default, plus
deterministic exact-edge probes: 119 vs 120 minutes, 16:00:00.000 vs .001, 400 vs
401 km — `:12-18`). It exits 1 on any violation but is **not** in `make check` or
CI — run it by hand after a solver change.

### DB-backed tests (23 files — those importing `@/lib/db`)

These exist because the most important rule in the system is not enforced in
application code. No-overlap lives in Postgres as two GiST exclusion constraints
on `VehicleOccupancy`, filled by the `sync_vehicle_occupancy()` trigger
(`prisma/migrations/20260819100000_in_chula_may_share_a_car/migration.sql:42,74,79`).
A unit test of `canChain` proves nothing about what the database will accept.

`lib/booking/in-chula-shared-car.test.ts` is the model: it writes real `Booking`
rows, lets the trigger derive occupancy, and asserts the constraints permit two
in-Chula errands on one car while still refusing a NORMAL trip overlapping them
(recognised via `isExclusionViolation`, `lib/booking/db-errors.ts:9`). Its own
header states the reason: "The rule is enforced in Postgres, not in app code"
(`:14`).

The corollary — and its second test, `:87` — is that the constraints enforce the
§5c *exception*, not its *bound*. Two `inChula` rows match neither constraint at
any start distance, so the ten-minute pairing window lives in app code: the
predicate is `sharesCarWith` (`lib/booking/rotations.ts:135`, with
`IN_CHULA_PAIR_WINDOW_MINUTES = 10` at `:34`). Every write path must apply it.
The two automatic dispatch paths go through the shared helper
`findVehicleConflicts` (`lib/booking/vehicle-conflicts.ts:61`, called from
`batch-core.ts:266` and `matching-actions.ts:244`); `schedule-actions.ts` filters
with `sharesCarWith` inline (`:127`, `:542`), as do `actions.ts:70` and
`calendar-conflicts.ts:70`. A test that inserts rows directly cannot catch a path
that skips the check — test through the write path.

`lib/booking/db-date.test.ts` pins the other DB-only landmine. Prisma truncates
the local midnight you write to a `@db.Date` column to its **UTC** date, so at
+07 the stored calendar date is the day *before* and reads back as UTC midnight
of that earlier day. Querying is symmetric and so the app looks correct; deriving
a key from the value read back is where it breaks. `startOfDay(row.date)` and
`format(row.date, "yyyy-MM-dd")` both yield the stored day — 24 h from the day
the row is about, which is how three leave/duty checks silently looked at the
wrong day. Compare with `dbDateKey` / `driverDayKey` (`lib/booking/db-date.ts:41`,
`:46`); where the day is displayed or iterated rather than compared, recover it
with `localDayOfDbDate` (`:61`). Three columns are `@db.Date`:
`DriverUnavailability.date`, `OnCallShift.date`, `AdHocVehicle.date`
(`prisma/schema.prisma:371,619,669`).

Conventions when adding one (see `schedule-actions.test.ts`,
`vehicle-occupancy.test.ts`):

- Pick a quiet far-future day — `startOfDay(addDays(new Date(), 90))` and up; the
  existing suites are spread from +90 to +400 so they do not collide with each
  other or with seed and demo data.
- Tag every fixture with a marker string in a column you own (`purpose` on
  bookings, `reason` on leave rows) and sweep on it in `afterAll`. These write to
  your real dev database.
- Read actors from the seed (`seed-user-admin`, `seed-user-requester`,
  `seed-user-driverstation`, `seed-dept-medicine`) rather than creating users.
  Fixtures also assume a paired active vehicle exists —
  `vehicle-occupancy.test.ts:31-34` throws "Need an active paired vehicle — run
  the seed" if it does not.

### Server-action tests

Server actions are ordinary async functions; call them with a `FormData` and mock
the Next runtime around them (`lib/booking/schedule-actions.test.ts:8-16`):

```ts
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (k: string) => k),
}));
vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ user: { id: "seed-user-admin", roles: ["ADMIN"] } })),
}));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/line/client", () => ({ sendLineNotification: vi.fn(async () => {}) }));
```

`getTranslations` returns the identity function, so assertions compare message
*keys*, not Thai strings. Mocks must be declared before the import of the module
under test; use `vi.hoisted` when the mock needs to change per test — a mutable
session holder (`lib/booking/create-booking-admin.test.ts:18-21`) or a bare
`vi.fn()` reset per case (`tests/station-trip.test.ts:7`).

An action that succeeds by redirecting does not return; it throws. Mock
`next/navigation`'s `redirect` to throw and assert with
`rejects.toThrow("NEXT_REDIRECT")` (`create-booking-admin.test.ts:4-8`, `:199`),
then read the database to find out what was actually written.

Two things these tests are specifically for:

- **Assert the server-side refusal, not the hidden button.** A server action is
  callable whether or not its button ever rendered
  (`lib/booking/demo-guard.test.ts:27-28`). And mock the *feature flag*, not
  `NODE_ENV` — the bundler may inline `NODE_ENV`, leaving the guard reading a
  value your test never changed (`:10-13`).
- **Post the forged field.** `z.object` runs in strip mode, so an undeclared
  FormData key is silently dropped — but a field that *is* declared and ungated
  is a privilege hole. `jobType` is declared in `newBookingSchema`
  (`lib/booking/schema.ts:107`), and until 2026-08-20 the action preferred the
  submitted value over the classifier, so a requester posting `jobType=TJW`
  jumped the priority order and could pull the duty car. The regression test is
  `create-booking-admin.test.ts:187`: put the forged value in the FormData and
  assert the action ignored it.

### The i18n key test

`tests/i18n-keys.test.ts` is the only guard against a missing message key.
next-intl resolves keys at runtime: tsc cannot see a missing one, `npm run build`
cannot see it, and the page renders the literal key path (`titleStation`) to a
Thai-only user. Three checks:

1. Every literal `t("key")` resolved against the namespace its translator was
   created with; the walker asserts it found more than 500 call sites, so a
   broken walker fails rather than passing vacuously (`:62`).
2. Enum-derived namespaces pinned against `prisma/schema.prisma` (`:80-98`) —
   every `BookingStatus` and `JobType` value must have a message in the `status`
   and `jobType` namespaces, plus the `status_`-prefixed keys in
   `historyFilters` (which carries an explicit skip list for the non-terminal
   statuses). This exists because `AWAITING_DOCUMENT` shipped as a raw key when
   the enum grew and `th.json` did not.
3. Header nav labels, which are fully-qualified keys through a root translator
   (`:102`).

**Known blind spot:** template-literal keys, `t(\`reason_${x}\`)`, are invisible
to the walker (`:12-14`). If you add one, pin its value set the way the enum
check does, or it is unguarded.

## Running the tests needs a live database

23 of the 63 files talk to Postgres through `lib/db.ts`, and being judged by real
constraints is the entire point of them. There is no vitest setup file and no
mocked Prisma client: the generated client loads `.env` itself (its
`schemaEnvPath` points at the repo root), so whatever `DATABASE_URL` points at is
what the tests write to. Point it at a dev database you do not mind mutating, and
run `npx prisma migrate deploy && npx prisma db seed` first — fixtures reference
seeded ids and a paired active vehicle.

**Serialization.** DB-backed suites share one database and the same seed rows, so
in parallel they fight over singleton state: the day's `OnCallShift` row (one per
date), the `vehicle_occupancy_no_overlap` exclusion constraint, and the drivers'
rotation stamps. `vitest.config.ts:13` sets `fileParallelism: false`, so plain
`npm test` — the form CI uses — is serialized exactly as `make test` runs it
locally. The explicit `--no-file-parallelism` in `Makefile:18` predates that
setting and is now belt-and-braces. If you still see unique-constraint races,
something else is connected to the database.

**Timezone.** Run with `TZ=Asia/Bangkok`. On a UTC machine the day-window and
`@db.Date` tests describe a system that is not the one in production, and the
`booking_leg2_start` SQL function hardcodes Asia/Bangkok while `trip-legs.ts`
uses process-local time — a mismatch that produces false conflicts or missed
double-books. `instrumentation.ts` guards the running *server* against this, not
your test run.

## Browser verification: `scripts/devtools/cdp.py`

For everything vitest structurally cannot reach: a click that runs a server
action, a drag on the scheduler board, hydration, focus rings, console errors.

The previous harness drove headless Chrome with `--virtual-time-budget`, which
advances without pausing for the network — so every scripted click fired into
server HTML React had not adopted, and a dead button looked exactly like a
working one (`cdp.py:4-9`). This script talks real CDP over a stdlib WebSocket
and waits on real conditions.

```bash
npm run dev    # in another shell
python3 scripts/devtools/cdp.py 'http://localhost:3000/admin/schedule?date=2026-09-01' \
    --cookie dev_user_id=seed-user-admin --wait-hydrated --eval-file /tmp/click.js
```

| Flag | Effect |
|---|---|
| `--cookie name=value` | sets a cookie over CDP before navigation (`:255-261`) |
| `--wait-hydrated` | polls for React's `__react*` keys; reports `hydrated` in the output (`:194-206`) |
| `--eval-file F` | evaluates `F` after load; its return value is printed as JSON |
| `--shot OUT.png` | full-page screenshot; add `--viewport` for just what is on screen |
| `--w N` `--h N` | window size (default 1280×1600, `:246`) |
| `--emulate WxH` | device-metrics override — use this, not `--w`, for narrow viewports |
| `--tab N` | N real `Tab` key presses via `Input.dispatchKeyEvent` (`:270-281`) |
| `--console` | collects exceptions and error/warning console entries into the output (`:288-304`) |

Five things that bite:

1. **The eval file is a function body, not an expression.** It is wrapped in
   `(async () => { … })()` (`:158`), so you must `return` the value you want
   printed. `await` is allowed.
2. **Auth is the dev cookie** `dev_user_id` (`lib/dev-auth.ts:5`), set over CDP
   rather than through a reverse proxy — the proxy could not relay Turbopack's
   HMR WebSocket upgrade, and without that socket the dev runtime never streams
   the flight payload, so nothing hydrated (`cdp.py:251-254`). Dev impersonation
   is `NODE_ENV !== "production"` only, with no env escape hatch
   (`lib/dev-auth.ts:12`).
3. **Use `localhost`, not `127.0.0.1`** — the cookie's domain is hardcoded to
   `localhost` (`:260`), so a `127.0.0.1` URL arrives unauthenticated and lands
   on `/login`.
4. **`--w 375` lies.** Chrome headless on macOS refuses a window narrower than
   about 500 px, so a "mobile" screenshot taken that way is not one. Use
   `--emulate 375x800`, which is applied at the page level (`:166-177`).
5. **`CHROME` is a hardcoded macOS path** (`:42`) — edit it on Linux.

Note that a page whose render throws is caught by its segment's `error.tsx`
(`app/(admin)/error.tsx` and siblings, plus `app/global-error.tsx`) and still
returns a rendered page with HTTP 200 — "it loaded" proves nothing. Assert on
body text, or pass `--console`.

## What to write for a new change

| You changed | Prove it with |
|---|---|
| a scheduling rule (`rotations`, `batch-solver`, `classification`, …) | read `docs/scheduling-algorithm.md` first; unit test beside the file **and** `make sim` (all seven, counters 0). Optionally `npx tsx scripts/stress-scheduler.ts` |
| fairness / rotation order / who gets the work | `make sim` will **not** catch it. Drive `solveDay()` directly and assert the recipients; compare the printed `fairness` line across all seven scenarios |
| a write path that assigns a vehicle or a driver | a DB-backed test that calls the real action, and confirm the path applies `sharesCarWith` — via `findVehicleConflicts` (`lib/booking/vehicle-conflicts.ts:61`) or the inline filter `schedule-actions.ts` uses. The DB alone cannot enforce the §5c window |
| a server action's auth or validation | a server-action test asserting the refusal server-side, with the forged field actually posted |
| a new UI string | nothing extra — `tests/i18n-keys.test.ts` covers literal `t("…")`. A template-literal key needs its own pin |
| a new enum value | nothing extra — the i18n enum check reads `schema.prisma`; just add the key to `messages/th.json` |
| `schema.prisma` | `npx prisma generate` before `make check`; a migration, plus a DB-backed test if it adds or changes a constraint |
| a `@db.Date` column, or any day-keying | a DB round-trip test in the style of `lib/booking/db-date.test.ts` |
| the scheduler board, the rounds board, any page interaction | `cdp.py` with `--wait-hydrated`, plus `npm run build` |
