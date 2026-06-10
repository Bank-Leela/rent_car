# Decision: Overflow reduction (sub-project D) — CLOSED, solver is near-optimal

Date: 2026-06-10
Status: **Closed — won't implement** (code-only). Revisit only via business levers.
Relates to: [2026-06-10-multiday-tjw-harness-design.md](./2026-06-10-multiday-tjw-harness-design.md)

---

## Question

After the honest harness (sub-project A+B) showed real `NO_PRIMARY` overflow at
**~28.5%** of bookings (vs the prior fictional ~16%), can a **code-only** change
to the batch solver reduce it without touching business rules (the 2-job/day
cap, the duty-driver reserve, driver count)?

## Investigation (measured on `lib/booking/simulation.ts`, seed 42, 1000 days)

1. **86% of overflow is genuine capacity exhaustion.** At the moment any
   booking overflows, **zero** non-duty, non-away, non-returnee drivers have a
   free, time-compatible slot. The greedy solver already extracts all idle
   capacity — there is no packing slack to recover from its own assignment.

2. **The naive "optimal" gap of +17.6% is invalid.** A packing-maximiser fits
   ~877 more bookings/1000 days, but only by **dropping higher-priority TJW/OT
   trips to seat more local NORMAL trips** — violating the
   `TJW → OT → WERN → NORMAL` category priority, which is a business rule
   (out-of-province TJW must not be sacrificed for local volume).

3. **The priority-respecting ceiling is ~2.3–2.7%** (113–135 more bookings/1000
   days, on ~12% of days). That is the honest, business-rule-safe upper bound —
   and it is itself optimistic (best of many random packings, not a real
   heuristic).

4. **Chain-aware heuristics capture nothing.** Processing NORMAL morning-first,
   and preferring drivers who can complete a morning+afternoon chain pair, both
   added **+0** over a plain priority+coverage greedy.

5. **The only lever for the ~2.3% is load-balanced driver selection** — picking
   the driver with the fewest trips *today* for TJW/OT/WERN instead of the
   per-category rotation (oldest `lastTjwAt` / `lastOtAt` / `lastDutyAt`). That
   **trades the fairness rotation protects**: even spread of high-burden TJW
   trips across drivers *over time*. Load-balancing by today's count lets TJW
   cluster on whoever is lightest each day, degrading per-category fairness.

## Decision

**Keep the solver as-is.** It already achieves ~97% of the priority-respecting
optimum. The residual ~2.3–2.7% is not worth changing core, well-tested
production code (`batch-solver.ts`, 119 passing tests) because the only
mechanism that captures it sacrifices TJW rotation fairness — a property the
business deliberately maintains.

## Durable invariant (do not re-litigate)

> Reducing `NO_PRIMARY` overflow below ~97% of the priority-respecting optimum
> requires **either** relaxing a business rule (2-job/day cap, duty reserve, or
> adding drivers) **or** sacrificing TJW per-category rotation fairness. It is
> **not** achievable as a pure-code packing/ordering change. Do not reopen
> "reduce overflow" as a solver-cleverness task; reopen it as a product
> decision about rules or capacity.

## How to reproduce / re-measure

The simulation harness (`lib/booking/simulation.ts` + `simulate()`) is the
instrument. To re-quantify the ceiling, run a per-day randomized feasible
greedy that **preserves category priority** (assign TJW, then OT, then WERN,
then NORMAL; respect duty/away/returnee exclusions, the 2-job cap, and
`canTake` chaining) and compare its best assignment count to the solver's. The
priority-respecting gap was ~2.7%; without the priority constraint it balloons
to a misleading ~17.6%.

## If overflow becomes a real operational problem

Pursue **business levers** (their own spec), quantified on the same harness:

- Raise the 2-job/day cap to 3 for short NORMAL trips (measure fairness +
  driver-fatigue impact).
- Add drivers / a relief driver for peak days (the 09:00 NORMAL window is the
  bottleneck — 1,109 of 1,951 `NO_PRIMARY` overflows start at 09:00).
- Surface overflow to ops with actionable options (outsource / waitlist /
  reclaim) so genuine demand spikes are handled rather than silently dropped.
