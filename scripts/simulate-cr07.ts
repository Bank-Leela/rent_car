// CR-07 simulator — feeds synthetic daily batches through `solveDay()` and
// reports fairness + rule-compliance.
//
// Per the supervisor's matrix: 6 drivers in the pool. 1 driver runs WERN
// (campus rounds) each day, leaving 5 fresh drivers. Each fresh driver can
// take at most 2 trips/day (morning + afternoon with the 2-hour buffer),
// so the daily ceiling is 5 × 2 = 10 + 1 duty = **11 cases per day**.
//
// Usage:
//   npx tsx scripts/simulate-cr07.ts [--days=60] [--seed=42] [--scenario=mixed]
//
// Scenarios:
//   mixed    — random mix of NORMAL / OT / TJW / WERN, includes some >400 km.
//   normal   — every booking NORMAL.
//   ot       — every booking OT (boundary times around the 8/16 cutoffs).
//   tjw      — TJW-heavy: drivers locked away on multi-day trips.
//   tight    — 11 cases every day, forces FCFS overflow.
//   chain    — same-day morning + afternoon chains for every driver.
//   reclaim  — 1 OT/day at >400 km with thin staffing to trigger
//              NEEDS_WERN_RECLAIM_DECISION.

import type { JobType } from "@prisma/client";
import { solveDay, type SolverBookingInput, type TjwCommitment } from "../lib/booking/batch-solver";
import type { DriverRotationState } from "../lib/booking/rotations";

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const TOTAL_DAYS = Number(argv.days ?? 60);
const SEED = Number(argv.seed ?? 42);
const SCENARIO = String(argv.scenario ?? "mixed") as Scenario;

type Scenario = "mixed" | "normal" | "ot" | "tjw" | "tight" | "chain" | "reclaim";

// ---------- seeded RNG ----------
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

// ---------- pool ----------
const DRIVERS = [
  { id: "d1", name: "สมชาย" },
  { id: "d2", name: "สุนีย์" },
  { id: "d3", name: "ประเสริฐ" },
  { id: "d4", name: "วีรพล" },
  { id: "d5", name: "อรทัย" },
  { id: "d6", name: "ณัฐพล" },
];

interface CaseLog {
  date: string;
  bookingId: string;
  jobType: JobType;
  role: "PRIMARY" | "SECONDARY";
  distance: number | null;
  startAt: string;
  endAt: string;
}

interface PersistentDriver {
  id: string;
  name: string;
  lastTjwAt: Date | null;
  lastOtAt: Date | null;
  lastDutyAt: Date | null;
  lastAssignedAt: Date | null;
  earningsScore: number;
  totals: { TJW: number; OT: number; WERN: number; NORMAL: number; SMUS: number };
  secondaryTotal: number;
  cases: CaseLog[];
}
const drivers: PersistentDriver[] = DRIVERS.map((d) => ({
  ...d,
  lastTjwAt: null,
  lastOtAt: null,
  lastDutyAt: null,
  lastAssignedAt: null,
  earningsScore: 0,
  totals: { TJW: 0, OT: 0, WERN: 0, NORMAL: 0, SMUS: 0 },
  secondaryTotal: 0,
  cases: [],
}));

// ---------- scenario generator ----------
function generateBookings(date: Date, scenario: Scenario, dutyDriverId: string): SolverBookingInput[] {
  const out: SolverBookingInput[] = [];
  // Synthesise the WERN booking for the duty driver (1 of the 11).
  out.push(makeWern(date));

  // How many non-duty bookings today? Scenario controls.
  let count: number;
  switch (scenario) {
    case "tight": count = 10; break;
    case "tjw":   count = randInt(2, 4); break;
    case "reclaim": count = 1; break;
    case "chain": count = 10; break;
    default:      count = randInt(3, 10);
  }
  count = Math.min(count, 10); // hard ceiling 10 non-duty.

  for (let i = 0; i < count; i++) {
    const submittedOffsetMin = i; // FCFS by submission index.
    out.push(makeBooking(date, scenario, i, submittedOffsetMin));
  }
  return out;
}

function makeWern(date: Date): SolverBookingInput {
  const startAt = new Date(date); startAt.setHours(8, 0, 0, 0);
  const endAt = new Date(date);   endAt.setHours(16, 0, 0, 0);
  const submittedAt = new Date(date.getTime() - 7 * 86400000);
  return {
    bookingId: `${ymd(date)}-wern`,
    jobType: "WERN",
    startAt,
    endAt,
    estimatedDistance: 30,
    outOfProvince: false,
    submittedAt,
  };
}

function makeBooking(date: Date, scenario: Scenario, idx: number, submittedOffsetMin: number): SolverBookingInput {
  const submittedAt = new Date(date.getTime() - 7 * 86400000 + submittedOffsetMin * 60_000);
  // Pick the slot deterministically by index so we cleanly hit the 2/day ceiling.
  const slot = idx % 2; // 0 = morning, 1 = afternoon
  const startAt = new Date(date);
  if (slot === 0) {
    startAt.setHours(8 + (idx % 3), 0, 0, 0);    // 08–10
  } else {
    startAt.setHours(13 + (idx % 3), 0, 0, 0);   // 13–15
  }
  let durationH = 2 + randInt(0, 1);
  let endAt = new Date(startAt.getTime() + durationH * 3_600_000);

  // Pick category by scenario.
  let jobType: JobType = "NORMAL";
  let estimatedDistance = randInt(20, 150);
  let outOfProvince = false;
  switch (scenario) {
    case "normal":
      jobType = "NORMAL";
      break;
    case "ot": {
      jobType = "OT";
      // OT triggered by edge time.
      if (idx % 2 === 0) {
        startAt.setHours(6, 0, 0, 0);
        endAt = new Date(startAt.getTime() + durationH * 3_600_000);
      } else {
        startAt.setHours(17, 0, 0, 0);
        endAt = new Date(startAt.getTime() + durationH * 3_600_000);
      }
      break;
    }
    case "tjw": {
      jobType = "TJW";
      estimatedDistance = randInt(300, 700);
      outOfProvince = true;
      startAt.setHours(7, 0, 0, 0);
      endAt = new Date(startAt.getTime() + 2 * 86400000); // 2-day TJW
      break;
    }
    case "reclaim": {
      // One OT trip per day, long distance, late time → forces secondary.
      jobType = "OT";
      estimatedDistance = 500;
      startAt.setHours(17, 0, 0, 0);
      endAt = new Date(startAt.getTime() + 3 * 3_600_000);
      break;
    }
    case "chain": {
      jobType = "NORMAL";
      break;
    }
    case "tight":
    case "mixed":
    default: {
      const roll = rand();
      if (roll < 0.5) jobType = "NORMAL";
      else if (roll < 0.8) {
        jobType = "OT";
        if (rand() < 0.5) { startAt.setHours(6, 0, 0, 0); endAt = new Date(startAt.getTime() + durationH * 3_600_000); }
        else { startAt.setHours(17, 0, 0, 0); endAt = new Date(startAt.getTime() + durationH * 3_600_000); }
      } else {
        jobType = "TJW";
        estimatedDistance = randInt(400, 700);
        outOfProvince = true;
        startAt.setHours(7, 0, 0, 0);
        endAt = new Date(startAt.getTime() + 2 * 86400000);
      }
      if (rand() < 0.1) estimatedDistance = 450 + randInt(0, 200); // sporadic >400 km
      break;
    }
  }

  return {
    bookingId: `${ymd(date)}-b${idx}`,
    jobType,
    startAt,
    endAt,
    estimatedDistance,
    outOfProvince,
    submittedAt,
  };
}

function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- run ----------
const outcomes = {
  matched: 0,
  overflow: { NO_SLOT: 0, NO_PRIMARY_DRIVER: 0, NO_SECONDARY_DRIVER: 0, NEEDS_WERN_RECLAIM_DECISION: 0 },
  totalBookings: 0,
  totalDays: TOTAL_DAYS,
  capViolations: 0,        // a driver got >2 trips in a day
  bufferViolations: 0,     // a chained pair ended up <2 h apart
  wernConflictDays: 0,     // duty driver picked up a non-WERN trip
};
const activeTjwCommitments: TjwCommitment[] = [];
const phaseCHits = new Map<string, number>(); // per-driver Phase-C successes
let dutyCursor = 0;

for (let day = 0; day < TOTAL_DAYS; day++) {
  const date = new Date("2026-06-01T00:00:00");
  date.setDate(date.getDate() + day);

  // Prune expired TJW commitments.
  for (let i = activeTjwCommitments.length - 1; i >= 0; i--) {
    if (activeTjwCommitments[i]!.endAt < date) activeTjwCommitments.splice(i, 1);
  }

  // Today's duty driver: simple round-robin skipping drivers currently away on TJW.
  let dutyDriverId: string | null = null;
  for (let tries = 0; tries < DRIVERS.length; tries++) {
    const candidate = drivers[(dutyCursor + tries) % DRIVERS.length]!;
    const away = activeTjwCommitments.some((c) => c.driverId === candidate.id && c.startAt <= date && c.endAt >= date);
    if (!away) { dutyDriverId = candidate.id; break; }
  }
  dutyCursor = (dutyCursor + 1) % DRIVERS.length;
  if (!dutyDriverId) {
    // Whole pool is on TJW. Skip duty for the day.
    dutyDriverId = null;
  }

  const bookings = generateBookings(date, SCENARIO, dutyDriverId ?? "");
  outcomes.totalBookings += bookings.length;

  const states: DriverRotationState[] = drivers.map((d) => ({
    driverId: d.id,
    lastTjwAt: d.lastTjwAt,
    lastOtAt: d.lastOtAt,
    lastDutyAt: d.lastDutyAt,
    earningsScore: d.earningsScore,
    lastAssignedAt: d.lastAssignedAt,
  }));

  const result = solveDay({
    date,
    bookings,
    drivers: states,
    dutyDriverId,
    activeTjwCommitments: [...activeTjwCommitments],
  });

  // Persist rotations / counts.
  for (const a of result.assignments) {
    outcomes.matched += 1;
    const booking = bookings.find((b) => b.bookingId === a.bookingId)!;
    const primary = drivers.find((d) => d.id === a.primaryDriverId)!;
    primary.totals[booking.jobType] += 1;
    primary.lastAssignedAt = date;
    primary.earningsScore += 1;
    primary.cases.push({
      date: ymd(date),
      bookingId: a.bookingId,
      jobType: booking.jobType,
      role: "PRIMARY",
      distance: booking.estimatedDistance,
      startAt: booking.startAt.toISOString().slice(11, 16),
      endAt: booking.endAt.toISOString().slice(11, 16),
    });
    if (booking.jobType === "TJW") primary.lastTjwAt = date;
    if (booking.jobType === "OT") primary.lastOtAt = date;
    if (booking.jobType === "WERN") primary.lastDutyAt = date;
    if (a.secondaryDriverId) {
      const sec = drivers.find((d) => d.id === a.secondaryDriverId)!;
      sec.secondaryTotal += 1;
      sec.lastAssignedAt = date;
      sec.earningsScore += 1;
      sec.cases.push({
        date: ymd(date),
        bookingId: a.bookingId,
        jobType: booking.jobType,
        role: "SECONDARY",
        distance: booking.estimatedDistance,
        startAt: booking.startAt.toISOString().slice(11, 16),
        endAt: booking.endAt.toISOString().slice(11, 16),
      });
      if (booking.jobType === "TJW") sec.lastTjwAt = date;
      if (booking.jobType === "OT") sec.lastOtAt = date;
    }
    if (booking.jobType === "TJW") {
      activeTjwCommitments.push({ driverId: a.primaryDriverId, startAt: booking.startAt, endAt: booking.endAt });
      if (a.secondaryDriverId) {
        activeTjwCommitments.push({ driverId: a.secondaryDriverId, startAt: booking.startAt, endAt: booking.endAt });
      }
    }
    // Track Phase-C: a driver whose lastTjw end-date matches today's date and
    // took an OT today.
    if (booking.jobType === "OT") {
      const wasTjwReturnee = activeTjwCommitments.some(
        (c) => c.driverId === a.primaryDriverId &&
          c.endAt.getFullYear() === date.getFullYear() &&
          c.endAt.getMonth() === date.getMonth() &&
          c.endAt.getDate() === date.getDate(),
      );
      if (wasTjwReturnee) phaseCHits.set(a.primaryDriverId, (phaseCHits.get(a.primaryDriverId) ?? 0) + 1);
    }
  }
  for (const o of result.overflows) {
    outcomes.overflow[o.reason] += 1;
  }

  // Rule violation checks.
  for (const trips of result.driverDay.values()) {
    if (trips.length > 2) outcomes.capViolations += 1;
    if (trips.length === 2) {
      const [a, b] = trips.sort((x, y) => x.startAt.getTime() - y.startAt.getTime()) as [typeof trips[0], typeof trips[0]];
      const gapMs = b.startAt.getTime() - a.endAt.getTime();
      if (gapMs < 2 * 3_600_000) outcomes.bufferViolations += 1;
    }
  }
  // Duty driver should never appear in a non-WERN trip's driver lineup.
  if (dutyDriverId) {
    for (const a of result.assignments) {
      const booking = bookings.find((b) => b.bookingId === a.bookingId)!;
      if (booking.jobType === "WERN") continue;
      if (a.primaryDriverId === dutyDriverId || a.secondaryDriverId === dutyDriverId) {
        outcomes.wernConflictDays += 1;
      }
    }
  }
}

// ---------- report ----------
console.log(`\nCR-07 simulation — scenario=${SCENARIO}, days=${TOTAL_DAYS}, seed=${SEED}\n`);
console.log(`bookings  : ${outcomes.totalBookings}`);
console.log(`matched   : ${outcomes.matched} (${((outcomes.matched / outcomes.totalBookings) * 100).toFixed(1)}%)`);
console.log(`overflow  :`);
for (const [reason, n] of Object.entries(outcomes.overflow)) {
  if (n > 0) console.log(`   ${reason.padEnd(28)} ${n}`);
}

console.log(`\nrule checks (all should be 0):`);
console.log(`   2/day cap violations          ${outcomes.capViolations}`);
console.log(`   2h buffer violations          ${outcomes.bufferViolations}`);
console.log(`   duty driver doing extra work  ${outcomes.wernConflictDays}`);

console.log(`\nper-driver totals:`);
const widest = Math.max(...drivers.map((d) => d.earningsScore));
for (const d of drivers) {
  const bar = "█".repeat(Math.round((d.earningsScore / Math.max(widest, 1)) * 30));
  const t = d.totals;
  console.log(
    `  ${d.name.padEnd(8)} ` +
    `${String(d.earningsScore).padStart(3)} ` +
    `${bar.padEnd(30)}  ` +
    `TJW=${t.TJW} OT=${t.OT} WERN=${t.WERN} NRM=${t.NORMAL} 2nd=${d.secondaryTotal}`,
  );
}

const eVals = drivers.map((d) => d.earningsScore);
const mean = eVals.reduce((a, b) => a + b, 0) / eVals.length;
const variance = eVals.reduce((s, v) => s + (v - mean) ** 2, 0) / eVals.length;
console.log(`\nfairness  : mean=${mean.toFixed(2)}  stddev=${Math.sqrt(variance).toFixed(2)}  spread=${Math.max(...eVals) - Math.min(...eVals)}`);
console.log(`phase-C uses (TJW returnee took OT today):`);
for (const d of drivers) {
  const hits = phaseCHits.get(d.id) ?? 0;
  if (hits > 0) console.log(`   ${d.name} → ${hits}`);
}
if (phaseCHits.size === 0) console.log(`   (none in this scenario)`);
console.log("");

// ---- per-driver case log (opt-in) ----
//   --detail              dump every driver's full trip list
//   --driver=สมชาย         only that driver (also accepts d1..d6)
//   --first=N             only the first N cases (default 20 when --detail)
const detail = argv.detail === "true" || argv.driver;
if (detail) {
  const focus = argv.driver ? String(argv.driver) : null;
  const first = Number(argv.first ?? (focus ? 9999 : 20));
  const targets = drivers.filter(
    (d) => !focus || d.name === focus || d.id === focus,
  );
  for (const d of targets) {
    console.log(`\n──── ${d.name} (${d.id}) — ${d.cases.length} cases ────`);
    if (d.cases.length === 0) {
      console.log("   (no cases assigned)");
      continue;
    }
    const slice = d.cases.slice(0, first);
    for (const c of slice) {
      const dist = c.distance === null ? "—" : `${c.distance}km`;
      const tag = c.role === "SECONDARY" ? "[2nd]" : "[1st]";
      console.log(
        `   ${c.date}  ${c.startAt}-${c.endAt}  ${c.jobType.padEnd(6)}  ${tag}  ${dist.padStart(6)}  ${c.bookingId}`,
      );
    }
    if (d.cases.length > first) {
      console.log(`   … (${d.cases.length - first} more, pass --first=N to extend)`);
    }
  }
  console.log("");
}
