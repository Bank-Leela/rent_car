<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Scheduling rules (source of truth)

The driver/vehicle assignment rules live in **`docs/scheduling-algorithm.md`** —
priority (TJW → OT → WERN → NORMAL), the `canChain` eligibility rule (universal
2h gap; NORMAL capped at one morning + one afternoon; OT exempt from the cap but
not the gap), the **no-overlap rule** (no car may double-book — not even the duty
car; a manual override may relax only the 2h gap), the placement recommendation
obeying `canChain`, and the >400 km co-driver pairing.

Before changing any of `lib/booking/{rotations,batch-solver,batch-actions,matching,matching-actions,overtime-reco,driver-capacity,placement-reco,earnings,schedule-actions,tjw-request-solver,leave-core,availability-actions}.ts`
or `lib/booking/driver-rounds.ts` / `components/driver/driver-rounds-board.tsx`
(the whiteboard rounds board — it sits beside the drag-and-drop timeline
`components/admin/scheduler-board*`, which was deleted and then restored, not
replaced), the hotspots, read that doc first — this subsystem has churned because
the rule kept being re-derived.

Driver leave / sick day is **§9b** of that doc: which seat the absent driver held
decides what moves, and a trip already departed or spanning in from an earlier
day is flagged, never re-dispatched.

Verify scheduling changes: `npm test` (the `canChain`, `solver-invariants`, and
`overtime-reco` tests encode the rule) **and** the scenarios
`npx tsx scripts/simulate-cr07.ts --scenario=<mixed|normal|ot|tjw|tight|chain|reclaim>`
(rule-check counters must stay 0).
