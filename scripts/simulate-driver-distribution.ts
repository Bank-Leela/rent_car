/* Dev analysis: run N days through the real batch solver (solveDay) with
 * rotation state AND multi-day TJW commitments carried across days, then report
 * overflow-by-cause, fairness, utilization, and TJW away-time. Pure in-memory —
 * no DB. The day-loop lives in lib/booking/simulation.ts (shared with the
 * solver-invariants property test). Run: npx tsx scripts/simulate-driver-distribution.ts
 *
 * NOTE: synthetic load is for RELATIVE comparison (before/after a change), not
 * an absolute capacity claim about real demand.
 */
import { simulate } from "@/lib/booking/simulation";
import type { JobType } from "@prisma/client";

const NUM_DAYS = 1000;
const SEED = 42;
const LONG_TJW_PROB = 0.4; // fraction of (always-overnight) TJW that run 2–3 days
const JOB_TYPES: JobType[] = ["TJW", "OT", "WERN", "NORMAL"];

const { metrics } = simulate({ days: NUM_DAYS, seed: SEED, longTjwProb: LONG_TJW_PROB });

console.log(
  `Simulated ${metrics.days} days, ${metrics.numDrivers} drivers (duty rotates daily; ` +
    `TJW always overnight, ${Math.round(LONG_TJW_PROB * 100)}% of them 2–3 days).`,
);
console.log(
  `Bookings: ${metrics.totalBookings} | assigned: ${metrics.totalAssigned} | ` +
    `overflow: ${metrics.totalBookings - metrics.totalAssigned} ` +
    `(${((1 - metrics.totalAssigned / metrics.totalBookings) * 100).toFixed(1)}%)`,
);
console.log(`Overflow by reason:`, metrics.overflowByReason);

console.log(`\nDriver x JobType (trips driven, primary+secondary):`);
console.log(["driver", ...JOB_TYPES, "TOTAL", "earn"].join("\t"));
for (const driverId of Object.keys(metrics.perDriverByType)) {
  const row = metrics.perDriverByType[driverId]!;
  const total = JOB_TYPES.reduce((s, jt) => s + row[jt], 0);
  console.log(
    [driverId, ...JOB_TYPES.map((jt) => row[jt]), total, Math.round(metrics.earnings[driverId]!)].join("\t"),
  );
}

console.log(`\nPer-type spread (min..max across drivers):`);
for (const jt of JOB_TYPES) {
  const [min, max] = metrics.fairness.perType[jt];
  console.log(`  ${jt}: ${min}..${max}`);
}
console.log(`Fairness Gini (total trips): ${metrics.fairness.gini.toFixed(3)} (0 = perfectly equal)`);

const u = metrics.utilization;
console.log(`\nUtilization (driver-days):`);
console.log(
  `  busy ${u.busyDriverDays} | idle ${u.idleDriverDays} | away-on-TJW ${u.awayDriverDays} | total ${u.totalDriverDays}`,
);
console.log(
  `  busy ${((u.busyDriverDays / u.totalDriverDays) * 100).toFixed(1)}% | ` +
    `away ${((u.awayDriverDays / u.totalDriverDays) * 100).toFixed(1)}%`,
);
console.log(
  `\nMulti-day TJW: ${metrics.tjw.multiDayCount} trips, avg away-span ${metrics.tjw.avgAwaySpanDays.toFixed(2)} days.`,
);
