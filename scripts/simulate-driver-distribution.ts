/* Dev analysis: simulate N days through the real batch solver (solveDay) with
 * rotation state carried across days, and tally per-driver per-jobtype trips.
 * Pure in-memory — no DB. Run: npx tsx scripts/simulate-driver-distribution.ts */
import { solveDay, type SolverBookingInput } from "@/lib/booking/batch-solver";
import { JOB_WEIGHT } from "@/lib/booking/classification";
import type { DriverRotationState } from "@/lib/booking/rotations";
import type { JobType } from "@prisma/client";

const NUM_DRIVERS = 6;
const NUM_DAYS = 1000;
const JOB_TYPES: JobType[] = ["TJW", "OT", "WERN", "NORMAL"];

// Deterministic PRNG so the run is reproducible.
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
const randint = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));

const drivers: DriverRotationState[] = Array.from({ length: NUM_DRIVERS }, (_, i) => ({
  driverId: `D${i + 1}`,
  lastTjwAt: null, lastOtAt: null, lastDutyAt: null, lastAssignedAt: null, earningsScore: 0,
}));

const tally = new Map<string, Record<string, number>>();
for (const d of drivers) tally.set(d.driverId, { TJW: 0, OT: 0, WERN: 0, NORMAL: 0 });

let totalAssigned = 0, totalOverflow = 0, totalBookings = 0;
const overflowByReason: Record<string, number> = {};
const base = new Date("2026-01-01T00:00:00");

for (let day = 0; day < NUM_DAYS; day++) {
  const date = new Date(base); date.setDate(date.getDate() + day);
  const dutyDriverId = `D${(day % NUM_DRIVERS) + 1}`;
  const counts = { TJW: randint(0, 2), OT: randint(1, 3), WERN: randint(0, 1), NORMAL: randint(2, 5) };
  const bookings: SolverBookingInput[] = [];
  let seq = 0;
  const mk = (jt: JobType, sh: number, eh: number, dist: number) => {
    const s = new Date(date); s.setHours(sh, 0, 0, 0);
    const e = new Date(date); e.setHours(eh, 0, 0, 0);
    bookings.push({ bookingId: `${day}-${seq}`, jobType: jt, startAt: s, endAt: e, estimatedDistance: dist, outOfProvince: jt === "TJW", submittedAt: new Date(date.getTime() + seq) });
    seq++;
  };
  for (let i = 0; i < counts.TJW; i++) mk("TJW", 6, 18, randint(100, 800)); // some >400 km -> secondary
  for (let i = 0; i < counts.OT; i++) mk("OT", i % 2 ? 18 : 5, i % 2 ? 21 : 9, randint(20, 90));
  for (let i = 0; i < counts.WERN; i++) mk("WERN", 8, 12, 15);
  for (let i = 0; i < counts.NORMAL; i++) { const am = i % 2 === 0; mk("NORMAL", am ? 9 : 13, am ? 11 : 15, randint(5, 60)); }
  totalBookings += bookings.length;

  const out = solveDay({ date, bookings, drivers, dutyDriverId, activeTjwCommitments: [] });
  const stamp = date;
  for (const a of out.assignments) {
    const bump = (id: string) => {
      tally.get(id)![a.jobType] += 1;
      const d = drivers.find((x) => x.driverId === id)!;
      if (a.jobType === "TJW") d.lastTjwAt = stamp;
      else if (a.jobType === "OT") d.lastOtAt = stamp;
      else if (a.jobType === "WERN") d.lastDutyAt = stamp;
      d.lastAssignedAt = stamp;
      d.earningsScore += JOB_WEIGHT[a.jobType] ?? 0;
    };
    bump(a.primaryDriverId);
    if (a.secondaryDriverId) bump(a.secondaryDriverId);
    totalAssigned++;
  }
  for (const o of out.overflows) { totalOverflow++; overflowByReason[o.reason] = (overflowByReason[o.reason] ?? 0) + 1; }
}

console.log(`Simulated ${NUM_DAYS} days, ${NUM_DRIVERS} drivers (duty rotates daily).`);
console.log(`Bookings generated: ${totalBookings} | assigned: ${totalAssigned} | overflow: ${totalOverflow}`);
console.log(`Overflow by reason:`, overflowByReason);
console.log(`\nDriver x JobType (trips driven, primary+secondary):`);
console.log(["driver", ...JOB_TYPES, "TOTAL", "earn"].join("\t"));
for (const d of drivers) {
  const t = tally.get(d.driverId)!;
  const total = JOB_TYPES.reduce((s, jt) => s + t[jt], 0);
  console.log([d.driverId, ...JOB_TYPES.map((jt) => t[jt]), total, Math.round(d.earningsScore)].join("\t"));
}
const sums = JOB_TYPES.map((jt) => drivers.reduce((s, d) => s + tally.get(d.driverId)![jt], 0));
console.log(["TOTAL", ...sums, sums.reduce((a, b) => a + b, 0), ""].join("\t"));
console.log(`\nPer-type spread (min..max across drivers):`);
for (const jt of JOB_TYPES) {
  const vals = drivers.map((d) => tally.get(d.driverId)![jt]);
  console.log(`  ${jt}: ${Math.min(...vals)}..${Math.max(...vals)} (avg ${Math.round(vals.reduce((a, b) => a + b) / NUM_DRIVERS)})`);
}
