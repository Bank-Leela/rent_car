# Auto-resolve schedule conflicts — design

**Date:** 2026-06-18
**Status:** approved (design)
**Subsystem:** scheduling (`docs/scheduling-algorithm.md` is the rule source of truth)

## Problem

The schedule board's **จัดอัตโนมัติ / auto-assign** button (`autoAssignAll` in
`scheduler-board.tsx`) only acts on `work = unassigned (no car) + driverless`.
A booking that is **already assigned but overlaps another trip on the same car**
— the red conflict ring, the one hard no-overlap rule (§5) — is ignored. The
badge shows 0 and the button does nothing for it. The admin must hand-fix every
double-book.

Request: the same button should also **resolve overlap conflicts among
already-scheduled trips**, the way it places queued ones.

## Decisions (locked with the user)

1. **Resolution = re-match the loser.** Keep one of the two overlapping trips on
   the car; pull the other (**loser**) off and auto-match it to a free legal car
   (same `recommendPlacement` the queue uses). No free car → leave it in place,
   report. **Non-destructive: a loser only moves when a legal target exists.**
2. **Loser = lower priority — except WERN/duty is pinned.** WERN is reserved all
   day (§1/§5) and may never be auto-relocated, so in any WERN-vs-other pair the
   *other* (intruder) trip is the loser: a duty-car conflict is resolved by
   freeing the car, never by re-homing duty work (which would drop coverage and
   bypass the NEEDS_WERN_RECLAIM_DECISION escalation, §6b). Otherwise keep the
   higher-priority trip and move the lower (**TJW > OT > NORMAL**, `SMUS` lowest);
   same type → the **later-submitted** (`createdAt`) trip moves; final tie →
   stable by id.

   *(Post-review fix: the original "TJW > OT > WERN > NORMAL" ranked WERN movable,
   letting a TJW/OT overlap silently relocate the duty trip — caught by the
   adversarial review and corrected to the WERN-pin above.)*

## Scope

- **Primary overlaps only** — matches the red ring (`scheduler-board-blocks.tsx`
  flags PRIMARY-vs-PRIMARY overlap; co-driver ghosts never conflict).
- **The duty car is never auto-reclaimed for a conflict.** If the only placement
  for a loser is the duty car (`recommendPlacement` → `reclaim`), it is **not**
  taken — reported instead. The loser (lower priority than WERN by rule when the
  conflict is on the duty car) simply moves to a free car; WERN stays put. This
  keeps §5 intact (only a manual drag may relax the 2h gap; overlap never auto).
- **One pass.** A loser that conflicts with several trips is moved once; any
  residual conflict stays red — click again. Greedy, may move a trip a prior
  move would have freed; always correct, never illegal.
- **Real DB datetimes** for overlap (multi-day aware), not the board's projected
  hours.

## Architecture (Approach A — dedicated server action)

### New: `lib/booking/conflict-resolve.ts` (pure, unit-tested)

```ts
type ConflictTrip = { id; vehicleId; startAt; endAt; jobType; submittedAt };
pickConflictLoser(a, b): ConflictTrip   // lower priority; tie → later-submitted; tie → id
findConflictLosers(trips: ConflictTrip[]): Set<string>  // per-car overlapping pairs → loser ids
```

`PRIORITY = { TJW:4, OT:3, WERN:2, NORMAL:1, SMUS:0 }`. Overlap =
`a.startAt < b.endAt && b.startAt < a.endAt`. Group by `vehicleId`, check every
pair, add the loser.

### New: `resolveScheduleConflictsAction(formData{date})` in `schedule-actions.ts`

1. `requireRole("ADMIN")`.
2. Load assigned primary trips overlapping the day (`status APPROVED|ASSIGNED`,
   `vehicleId` + `primaryDriverId` set, multi-day overlap window) with
   `createdAt`, `jobType`, `estimatedDistance`, `jobNumber`.
3. `findConflictLosers` → loser ids; none → `{ ok, resolved: 0, failures: [] }`.
4. **Per loser** (fresh each iteration, so a prior move is visible):
   `recommendForBookings(dayStart, [loser], false)` →
   - `fit` → `reassignVehicleAction(bookingId, vehicleId [, secondaryDriverId])`
     (re-checks overlap on the target, re-validates the co-driver). On ok:
     `resolved++` and `logTransition(action: "CONFLICT_RESOLVED")`.
   - `reclaim` / `none` / reassign error → push `"<jobNumber>: <reason>"`.
5. `revalidatePath("/admin/schedule")`; return `{ ok, resolved, failures }`.

Reuses the battle-tested reassign path (the only writer of a car assignment) and
the pure `recommendPlacement` (already obeys `canChain`: no overlap, ≥2h gap,
NORMAL cap). The loser is never recommended its own car — its current driver also
holds the kept trip, so `canChain` fails there.

### `app/(admin)/admin/schedule/page.tsx`

Add `createdAt` to the booking select. Compute
`conflictCount = findConflictLosers(assignedPrimaries).size`. Pass `conflictCount`
and the ISO `date` to `<SchedulerBoard>`.

### `components/admin/scheduler-board.tsx`

- New props `conflictCount: number`, `date: string`.
- Badge: `t("autoAssign", { count: work.length + conflictCount })`.
- Button disabled when `pending || work.length + conflictCount === 0`.
- `autoAssignAll`: after the existing queue loop, call
  `resolveScheduleConflictsAction({date})`; fold `resolved` into `assigned` and
  concat `failures` into the existing result summary.

### Docs + i18n

- `docs/scheduling-algorithm.md`: note the button now also auto-resolves overlap
  conflicts (loser rule + duty-car carve-out) under §8.
- No new user-facing strings strictly required (failures render as
  `jobNumber: reason`, matching the existing queue-failure format).

## Testing

- `lib/booking/conflict-resolve.test.ts`: `pickConflictLoser` (every priority
  pair + later-submitted tie + id tie) and `findConflictLosers` (no conflict,
  one pair, 3-way, multi-car isolation, chain).
- `npm test` (full suite incl. `canChain`, `solver-invariants`, `overtime-reco`).
- `npx tsx scripts/simulate-cr07.ts --scenario=<all>` — rule-check counters
  stay 0 (this adds a new action; it must not change solver output).
- `tsc --noEmit`, `eslint`, `next build`.

## Out of scope

- The `/admin/batch` `solveDay()` path (Approach C) — unchanged.
- Resolving 2h-gap-only or NORMAL-cap "soft" conflicts — those are intentionally
  admin-overridable (§5); only hard overlaps (the red ring) are auto-resolved.
- Iterative minimal-move optimization — single greedy pass for v1.
