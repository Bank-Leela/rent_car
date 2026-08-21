# `components/` — how the UI is organised

109 files, no barrel files, no index re-exports. Everything is imported by its
full path (`@/components/...`) — the only relative import in the whole directory
is the colocated test — so grep for a component name finds every use.

Read [`docs/PROJECT-OVERVIEW.md`](../docs/PROJECT-OVERVIEW.md) first if you do
not yet know what a booking, a เวร job, or P'Top is. This file only covers the
UI layer.

## The folders

| Folder | Count | What belongs here |
|---|---|---|
| `ui/` | 20 | Primitives with no domain knowledge — `button`, `input`, `select`, `dialog`, `table`, `date-time-picker`. Mostly shadcn-shaped wrappers over `@base-ui/react` (7 of them); no Radix in this project. `date-time-picker.tsx` is the one real exception to "no domain knowledge" — see below. |
| `forms/` | 30 | Anything that submits to a server action: `booking-form`, `assign-form`, `approve-form`, `cancel-form`, the account forms. Plus the two shared pieces every form uses — `use-form-action.ts` and `form-error.tsx`. |
| `admin/` | 28 | P'Top's screens: the timeline board and its parts, fleet/driver/user editors, the queue filter and bulk bar, leave calendar, ad-hoc (hired vehicle) rows. |
| `driver/` | 3 | The kiosk: `driver-rounds-board.tsx`, `today-trips-panel.tsx`, `kiosk-refresh.tsx`. Read-only by design — see the boards section. |
| `account/` | 2 | The settings-page section shell and rail (`account-section*.tsx`). |
| `dashboard/` | 2 | Recharts wrappers + the range filter. |
| `hooks/` | 1 | `use-action-toast.ts` — turns an `ActionResult` into a sonner toast. |
| *(root)* | 23 | Cross-role shared pieces: `app-shell`, `nav-links`, `page-header`, `hero-band`, `section`, `booking-status-badge`, `job-type-chip`, `empty-state` / `error-state` / `not-found-state` / `page-skeleton`, `theme-provider` / `theme-toggle`. |

The one test in here is `components/list-search.test.ts` (colocated because
`filterRows` is exported from `list-search.tsx:8`); `vitest.config.ts` includes
`components/**/*.test.ts` for exactly that file. Everything else is tested from
`lib/` or `tests/`.

`ui/date-time-picker.tsx` knows about bookings on purpose: it takes optional
`overnight`, `urgent`, `backdate` and `pickupReturn` (คอย/ไม่คอย + the driver's
return-pickup time) toggles that it renders inside its own popover
(`:40-79`). They are optional props supplied by the booking form, but they are
domain-shaped, and they are a large part of why the file is 692 lines. Do not
copy that as licence for the rest of `ui/`.

`driver/kiosk-refresh.tsx` is why the kiosk updates without anyone touching it:
`router.refresh()` every `intervalSec` (default 60) while the tab is visible
(`:12-27`). Drivers never claim work, so new work has to arrive on its own.

## The two boards

This is the single most confusing thing in the directory. There are two
schedule boards. They are not variants of each other; they answer different
questions for different people, and each has its own data module.

| | Timeline (drag-and-drop) | Whiteboard rounds |
|---|---|---|
| Component | `admin/scheduler-board.tsx` (+ `-blocks.tsx`, `-shared.ts`) | `driver/driver-rounds-board.tsx` |
| Data | `lib/booking/timeline-board-data.ts` — `loadTimelineBoard()` at `:44`, owns its own Prisma queries | `lib/booking/driver-rounds.ts` — `buildDriverRounds()` at `:119`, **pure, no I/O** (`:1-7`); the page owns the query |
| Rendered by | `app/(admin)/admin/schedule/page.tsx:176` | `app/(driver)/driver/schedule/page.tsx:187` |
| Axis | Cars down, **hours across** | Drivers down, **that driver's rounds across** as wrapping chips |
| Reader | P'Top, deciding | The drivers, at the shared `driverstation` kiosk |
| Editable | Yes — drag to assign / reassign / unassign, edit เวร hours | No. Tapping a round opens the trip so the driver can record mileage |

**The timeline is for placing a trip in time.** It is the only view where you
can see that car B is free 10:00–14:00, so it is the only one that can honestly
support drag-to-assign. It carries its own `DndContext`
(`scheduler-board.tsx:354`).

**The whiteboard is for reading your day.** It replaces a physical wall
whiteboard: one row per driver, rounds flowing left→right, colour only when the
trip is *not* ordinary. `driver-rounds.ts:1-7` explicitly makes no scheduling
decisions — it re-presents what the solver already assigned.

Two traps:

- **The timeline is not dead code.** It was deleted in `10c730f` ("refactor:
  delete the drag-and-drop timeline board") and restored in `1f731f4`
  ("feat(board): timeline drag-and-drop returns…"). AGENTS.md calls it out for
  this reason. Do not delete it again on the theory that the whiteboard
  supersedes it.
- **Some admin-side whiteboard parts are currently unrendered.**
  `admin/rounds-dnd.tsx` (`RoundsDnd`), `admin/unassigned-bar.tsx`, and
  `admin/adhoc-rows-panel.tsx` are not imported by any page today — the admin
  schedule page dropped the provider when the whiteboard left that page
  (`app/(admin)/admin/schedule/page.tsx:187-191` explains why). `DragRound` /
  `DropCarRow` and `RoundReassign` *are* still imported by
  `driver-rounds-board.tsx:6-7`, but only activate behind the `dnd` and
  `reassignTargets` props, which the kiosk page does not pass. That default is
  deliberate and is documented at `driver/driver-rounds-board.tsx:33-34`: "this
  same component IS the driver kiosk — a driver reading their day must not be
  able to re-dispatch it." Drivers are passive; P'Top decides.

### Lane packing is what keeps blocks from hiding each other

On the timeline, a car row is a strip of absolutely-positioned blocks. Two
concurrent trips on the same row would paint on top of each other and one would
be invisible. `admin/scheduler-board-blocks.tsx:430-446` packs them greedily
into stacked lanes — an item joins the first lane whose last item ends at or
before it starts, else opens a new lane — and the row's height is `laneCount *
LANE_PX` (`:576`). `AdHocRow` (`:716`) repeats the same loop at `:733-744`.

What feeds the packing matters: the car's own trips, **co-driver ghosts**, and
**no-wait return legs** all occupy lanes (`:406-429`), because all three occupy
the car's time. If you add a new kind of block, add it to `items` or it will be
drawn under something else.

Concurrent *primary* blocks on one car normally mean a double-book, which
Postgres forbids — except under §5c, where two in-Chula errands starting within
`IN_CHULA_PAIR_WINDOW_MINUTES` (10, `lib/booking/rotations.ts:34`) may legally
share a car. The board labels that case on the row rather than letting it read
as a bug: `maxShare` is computed at `:448-470` and the chip renders at
`:543-555`, grey at two and amber at three or more. Trips with `continuesBefore`
are deliberately excluded from the pairing count — their `startHour` is clamped
to the top of the viewed day, so two unrelated overnight trips would both read
as `0` and pair with each other. See `docs/scheduling-algorithm.md` §5c for the
accepted risk.

`admin/scheduler-board-shared.ts` is the timeline's shared module — **not**
shared with the whiteboard. Its importers are `scheduler-board.tsx`,
`scheduler-board-blocks.tsx`, the root `job-type-chip.tsx` (which pulls
`jobStyle`), and `lib/booking/timeline-board-data.ts:3`, which imports the
`SchedulerVehicle` / `SchedulerBooking` view-model types from it. That last one
is a server module depending on a file under `components/`; renaming or moving
this file breaks the data layer, not just the UI. The whiteboard has its own
independent colour map (`driver-rounds-board.tsx:65-70`), so a palette change
has to be made in both places.

Note `DEFAULT_START = 6` / `DEFAULT_END = 20` (`:99-116`) are the *narrowest*
window the axis may be, not a clamp — the board takes
`min(DEFAULT_START, earliest)` / `max(DEFAULT_END, latest)`
(`scheduler-board.tsx:107-108`), so a 05:00 TJW departure widens the axis rather
than being clipped.

## Files that stay big on purpose

AGENTS.md, verbatim:

> Do not propose a refactor of these as cleanup. Split one only when a change
> actually needs it, and say why in the commit.

That covers `forms/booking-form.tsx` (1404 lines),
`ui/date-time-picker.tsx` (692), and `admin/scheduler-board*` (615 + 807 + 135).

The reason is not sentiment. `booking-form.tsx` is one form with one submit
path, and its fields are interdependent, all off the single trip-area choice
(`:51-53`, `:664-669`): the area sets the lead-time floor (`leadDaysFor`,
`:66-68`), which sets the earliest selectable start date, which the picker
clamps; within-Chula drives รถเวร routing; upcountry unlocks the overnight
option; external charter forces `jobType=SMUS` (`:974`). That chain only reads
straight through when it is in one place. Same for the picker: popover
positioning, min/max clamping, and `yyyy-MM-ddTHH:mm` parsing are one behaviour,
not three. The scheduler board was split once and restored.

The >400 km co-driver rule is *not* in the form — it is
`LONG_TRIP_KM` (`lib/booking/classification.ts:21`), applied by the solver.

Proposing to split any of them as tidying is explicitly unwanted and will be
rejected.

## Server or client

Most of this directory is client. 79 of 109 files start with `"use client"`.
The practical rule:

| Needs `"use client"` | Can stay a server component |
|---|---|
| `useState` / `useTransition` / `useRef` / `useEffect` | `async function` that awaits Prisma or `getTranslations` |
| `onClick`, `onChange`, any handler prop | Pure presentation over props it is handed |
| `@dnd-kit`, `recharts`, `next-themes`, `sonner` | Anything whose only dynamism is a `<Link>` |
| `usePathname` / `useRouter` | |

Server components use `getTranslations` from `next-intl/server` (it is async —
you must `await` it); client components use `useTranslations` from `next-intl`.
`useTranslations` in a file without `"use client"` fails at render, not at build.

The pattern that keeps a component server-renderable is **passing translated
strings down as a `labels` / `legend` prop** instead of translating inside.
`driver/driver-rounds-board.tsx`, `admin/wern-strip.tsx` and
`driver/today-trips-panel.tsx` all do this, and all three are server components
with no `"use client"` even though they render client children.

`admin/leave-calendar.tsx` takes an `emptyLabel` prop for a different reason —
it *is* a server component and does call `getTranslations` internally. The
label is the caller's because the same calendar renders on `/admin/fleet` (where
a cell means "this car is parked") and `/admin/drivers` (where it means "this
person is off"), and hardcoding the empty-state string made a page about people
say "all cars available" (`:6-16`). The same comment records the other half:
the *page* owns the query, so the `@db.Date` → local-day conversion happens once,
at the read, and never again in the component.

### Server actions and the `"use server"` export rule

Every runtime export of a `"use server"` module must be an async function.
Types are erased and fine; constants, objects, and plain helpers are not. So
anything shared between two action modules has to live in a third, ordinary
module.

The live example: `withTimeOfDay` (`lib/booking/trip-legs.ts:77`) parses `HH:mm`
onto a booking's calendar day. Both `schedule-actions.ts:8` and
`approval-actions.ts:8` need it to apply the same leg-2 guard, and both are
`"use server"` — so it lives in `trip-legs.ts` instead
(`lib/booking/trip-legs.ts:69-76` states this). `lib/booking/actions.ts:21-24`
records the same constraint for `bookingDetailInclude`, which is why that lives
in its own `lib/booking/booking-detail-include.ts`.

The mirror-image constraint on the client side: `scheduler-board-shared.ts`
re-declares the work-day bounds as `WORK_START_HOUR` / `WORK_END_HOUR`
(`:118-122`) rather than importing `WORK_DAY_START_HOUR` /
`WORK_DAY_END_HOUR` (`lib/booking/classification.ts:17-18`), "so this file
stays free of server imports — it is pulled into client components." Both pairs
are 8 and 16; change one and you must change the other.

## Conventions that are load-bearing

**Thai text comes from `messages/th.json`, not from literals.** next-intl
resolves keys at **runtime**: `tsc` and `npm run build` both pass on a key that
does not exist, and the page then renders the raw key path — `titleStation` — to
a Thai user. `tests/i18n-keys.test.ts` is the only guard, and it checks
*literal* `t("…")` calls only; a template-literal key (``t(`reason_${x}`)``)
is out of its reach and is your responsibility (`:12-14`). This has shipped
twice.

There are a handful of deliberate hardcoded exceptions —
`ui/date-time-picker.tsx` (Thai weekday initials at `:83`, `aria-label`s) and the
`JOB_COLOR` labels in `scheduler-board-shared.ts:71-92`. Treat them as
exceptions, not as licence.

**Some server actions return an error CODE, not a message.** `ActionResult` is
`{ ok: true } | { ok: false; error: string; field?: string }`
(`lib/booking/actions.ts:17-19`), and the two halves of the codebase fill `error`
differently:

- `lib/booking/actions.ts` returns already-translated Thai (`te("bookingNotFound")`).
- `lib/booking/schedule-actions.ts` returns bare codes — `"vehicleBusy"`,
  `"noAssignedDriver"`, `"cannotAssignInStatus"`, `"tripAlreadyStarted"`,
  `"invalidInput"`, `"endBeforeStart"`, `"timeBreaksLegs"` and more (30 sites).

A component that displays a code raw shows a Thai admin the string
`cannotAssignInStatus`; that has happened
(`admin/scheduler-board.tsx:280-282`). The mapping from code to `scheduler.*`
key lives in the component, in **three separate ternaries that are not
identical** — `scheduler-board.tsx:161-166` (car drop), `:190-197` (co-driver
ghost, adds `coDriverSamePrimary`), `:283-292` (bulk assign, the only one that
maps `tripAlreadyStarted`). Everything unmatched falls through to `dropFailed`,
so a new code silently degrades to a generic message rather than erroring. Add a
new failure code to an action and you must add its arm here. `vehicleBusy` is
special-cased ahead of all three because it carries `conflicts` and can name the
blocking trip.

**Form submission goes through `useFormAction`.** `forms/use-form-action.ts`
owns `error` + `pending`, stamps `bookingId` onto the FormData when the caller
passes one (`:33`), runs the action in a transition, and surfaces `res.error`.
Pass `run` straight to `<form action={run}>`. Render the failure with
`<FormError message={error} />` (`forms/form-error.tsx` — not a client
component). For toasts, `hooks/use-action-toast.ts` returns `res.ok` so call
sites can branch on it.

**A hidden input is requester-controllable.** zod's `z.object` runs in strip
mode, so an undeclared FormData key is dropped — but a key that *is* declared
and not gated is a privilege hole. `booking-form.tsx:974` emits
`<input type="hidden" name="jobType" value="SMUS">`; posting `jobType=TJW` to
the same action used to put an ordinary errand at the top of the queue and let
it pull the duty car. The gate is `lib/booking/create-booking-action.ts:84` —
`isAdmin || data.jobType === "SMUS"`. If you add a hidden field, check there is
a gate for it server-side.

Related, same file: the boolean hidden fields must emit `"true"` or `""` —
**never** `"false"` — because `z.coerce.boolean()` (`lib/booking/schema.ts:112`,
`:115`) treats any non-empty string as true. `booking-form.tsx:959-963` says so
at the inputs.

**Native validation bubbles are suppressed app-wide.** `ValidationBubble`
(mounted once at `app/layout.tsx:64`) listens for `invalid` in the capture
phase, cancels the browser's unstyleable English bubble, and renders a themed
Thai one — including re-doing the focus-first-invalid behaviour the cancel
removes. No form opts in; `required` / `pattern` / `minLength` keep working. Do
not add a per-form replacement.

**`car = driver`.** `Vehicle.assignedDriverId`, one driver per car. On the
boards this means a row is simultaneously a car and a person: dropping a trip on
a car row assigns that car *and* its driver, and a driver on leave shows up as a
parked car (`scheduler-board-blocks.tsx:472-475`).
`driver-rounds-board.tsx:78-80` notes the consequence that the rows model
carries the car's *type* (เก๋ง / ตู้ / …) but not its id — the vehicle id
arrives via `reassignTargets`, the same admin-only prop that gates dragging.

## Before you change anything here

- `.ts`/`.tsx` changes: `make check` (typecheck + lint + test). Lint is part of
  the gate.
- Anything touching dispatch rules: read
  [`docs/scheduling-algorithm.md`](../docs/scheduling-algorithm.md) first, and
  run `make sim` (all seven scenarios; it exits non-zero on any violation).
- Client behaviour — a click, a drag, a drop — cannot be verified by fetching
  the page. Use `python3 scripts/devtools/cdp.py <url> --wait-hydrated`; see
  [`scripts/README.md`](../scripts/README.md).
