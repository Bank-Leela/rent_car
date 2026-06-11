# Decision: Overflow reduction (sub-project D) — CLOSED, solver is near-optimal

Date: 2026-06-10 · **Re-measured 2026-06-11 on the corrected TJW model**
Status: **Closed — won't implement** (code-only). Revisit only via business levers.
Relates to: [2026-06-10-multiday-tjw-harness-design.md](./2026-06-10-multiday-tjw-harness-design.md)

---

## Model correction (2026-06-11)

The first pass measured a harness that wrongly generated some **same-day TJW**
trips. Per the classifier, a TJW is *out-of-province AND overnight* — a same-day
out-of-province trip is NORMAL/OT, never TJW. The simulator now makes **every
TJW overnight** (`longTjwProb` = the fraction that run 2–3 days). That roughly
doubles driver away-time (≈24% of driver-days vs the old ≈15%), so the honest
overflow and the code-only headroom are both **higher** than the first pass
reported. All numbers below are the corrected ones (seed 42, 1000 days).

## Question

Can a **code-only** change to the batch solver reduce `NO_PRIMARY` overflow
(now ~**39.9%** of bookings under synthetic load) without touching business
rules (the 2-job/day cap, the duty-driver reserve, driver count)?

## Investigation (measured on `lib/booking/simulation.ts`, seed 42, 1000 days)

1. **~100% of overflow is genuine capacity exhaustion.** At the moment any
   booking overflows, **zero** non-duty, non-away, non-returnee drivers have a
   free, time-compatible slot (0 of 2,707 `NO_PRIMARY`). The greedy solver
   already extracts all idle capacity — there is no packing slack to recover
   from its own assignment.

2. **A no-priority "optimal" packing is invalid.** A packing-maximiser that
   ignores category priority fits far more, but only by **dropping
   higher-priority TJW/OT trips to seat more local NORMAL trips** — violating
   the `TJW → OT → WERN → NORMAL` rule (out-of-province TJW must not be
   sacrificed for local volume). Disqualified.

3. **The priority-respecting ceiling is ~5.6%** (+236 bookings/1000 days, on
   ~21% of days) — the honest, business-rule-safe upper bound, and itself
   optimistic (best of 120 random packings, not a real heuristic). Up from the
   ~2.7% the first (flawed) pass reported.

4. **Chain-aware heuristics still capture nothing.** Processing NORMAL
   morning-first, and preferring drivers who complete a morning+afternoon chain
   pair, both add **+0** over a plain priority+coverage greedy.

5. **The only lever for the gap is load-balanced driver selection** — picking
   the driver with the fewest trips *today* for TJW/OT/WERN instead of the
   per-category rotation (oldest `lastTjwAt`/`lastOtAt`/`lastDutyAt`). A
   deterministic version captures ~**4.4%** (+186/1000 days). But it **trades
   the fairness rotation protects**: even spread of high-burden TJW across
   drivers *over time*. Load-balancing by today's count lets TJW cluster on
   whoever is lightest each day, degrading per-category fairness.

## Decision

**Keep the solver as-is.** It achieves ~**94%** of the priority-respecting
optimum. The residual ~5.6% is not pursued because the only mechanism that
captures it sacrifices TJW rotation fairness — a property the business
deliberately maintains.

> ⚠️ **Closer call than before.** On the corrected model the headroom is ~5.6%
> (was ~2.7%). Still modest and still gated by the same fairness trade, so the
> decision stands — but if overflow becomes operationally painful, the
> load-balanced-selection lever (with a per-category fairness gate) is the first
> thing to reconsider before business levers.

## Durable invariant (do not re-litigate)

> Reducing `NO_PRIMARY` overflow below ~94% of the priority-respecting optimum
> requires **either** relaxing a business rule (2-job/day cap, duty reserve, or
> adding drivers) **or** sacrificing TJW per-category rotation fairness. It is
> **not** achievable as a pure-code packing/ordering change (chain-aware
> heuristics capture 0). Reopen it as a product decision about rules/capacity,
> or as an explicit fairness-vs-throughput trade — not as solver cleverness.

## How to reproduce / re-measure

The harness (`lib/booking/simulation.ts` + `simulate()`, `longTjwProb` default
0.4) is the instrument. Run a per-day randomized feasible greedy that
**preserves category priority** (assign TJW, then OT, then WERN, then NORMAL;
respect duty/away/returnee exclusions, the 2-job cap, and `canTake` chaining)
and compare its best assignment count to the solver's. Priority-respecting gap
≈ 5.6%; the no-priority packing is much larger but invalid (drops TJW).

## If overflow becomes a real operational problem

Pursue **business levers** (their own spec), quantified on the same harness:

- Raise the 2-job/day cap to 3 for short NORMAL trips (measure fairness +
  driver-fatigue impact).
- Add drivers / a relief driver for peak days — the **09:00 NORMAL window** is
  the bottleneck (1,405 of 2,707 `NO_PRIMARY` overflows start at 09:00; 13:00 is
  next at 726).
- Surface overflow to ops with actionable options (outsource / waitlist /
  reclaim) so genuine demand spikes are handled rather than silently dropped.
