// CR-06 simulation. Feeds synthetic bookings through the pure matcher to
// inspect fairness, the 1/day-per-driver cap, the 2 h morning-afternoon
// override, and the duty-driver/duty-vehicle pre-block.
//
// Usage:  npx tsx scripts/simulate-matcher.ts [--bookings=200] [--seed=42]

import type { JobType, TimeBucket } from "@prisma/client";
import { buildSlotTable, bucketFromStart, type SlotInput, type ExistingTrip } from "../lib/booking/slot-allocation";
import {
  buildDriverMatrix,
  type DriverInput,
  type DriverAvailabilityInput,
  type DriverBusyTrip,
  type RankInput,
  type TripWindow,
} from "../lib/booking/driver-capacity";
import { match } from "../lib/booking/matching";

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const TOTAL_BOOKINGS = Number(argv.bookings ?? 200);
const SEED = Number(argv.seed ?? 42);

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

const DRIVERS = ["สมชาย", "สุนีย์", "ประเสริฐ", "วีรพล", "อรทัย", "ณัฐพล"];
const VEHICLES: SlotInput[] = [
  { vehicleId: "v1", registrationNumber: "B-1001", isDutyVehicle: false },
  { vehicleId: "v2", registrationNumber: "B-1002", isDutyVehicle: false },
  { vehicleId: "v3", registrationNumber: "B-1003", isDutyVehicle: false },
  { vehicleId: "v4", registrationNumber: "B-1004", isDutyVehicle: false },
  { vehicleId: "v5", registrationNumber: "B-1005", isDutyVehicle: false },
  { vehicleId: "duty", registrationNumber: "DUTY-01", isDutyVehicle: true },
];
// CR-06: matcher-eligible categories. ON_CALL is reserved for the duty
// driver's campus rounds — those aren't routed through the matcher.
const BOOKABLE_JOB_TYPES: JobType[] = ["NORMAL", "OT", "TJW"];
const BOOKABLE_BUCKETS: TimeBucket[] = ["MORNING_08_12", "AFTERNOON_12_16"];

interface DayBooking {
  bookingId: string;
  day: string;
  vehicleId: string;
  timeBucket: TimeBucket;
  jobType: JobType;
  startAt: Date;
  endAt: Date;
  primaryDriverId: string;
  secondaryDriverId: string | null;
}
const drivers = DRIVERS.map((name, i) => ({
  id: `d${i + 1}`,
  name,
  joinedAt: new Date("2026-01-01"),
  lastAssignedAt: null as Date | null,
  earnings: 0,
  tripsThisMonth: 0,
  byJobType: { TJW: 0, OT: 0, WERN: 0, NORMAL: 0, SMUS: 0 } as Record<JobType, number>,
}));
const allBookings: DayBooking[] = [];

type Outcome = { ok: true } | { ok: false; reason: string };
const outcomes: Outcome[] = [];
let escalated = 0;

const dayString = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Daily on-call rotation: simple round-robin across the simulation.
const onCallByDay = new Map<string, string>();
let onCallCursor = 0;
function onCallFor(day: string): string {
  const cached = onCallByDay.get(day);
  if (cached) return cached;
  const id = drivers[onCallCursor % drivers.length]!.id;
  onCallCursor += 1;
  onCallByDay.set(day, id);
  return id;
}

for (let i = 0; i < TOTAL_BOOKINGS; i++) {
  const dayOffset = Math.floor(rand() * 40);
  const day = new Date("2026-06-01T00:00:00");
  day.setDate(day.getDate() + dayOffset);
  const ymd = dayString(day);
  const bucket = pick(BOOKABLE_BUCKETS);
  const jobType = pick(BOOKABLE_JOB_TYPES);

  // Concrete trip times inside the bucket.
  const startAt = new Date(day);
  if (bucket === "MORNING_08_12") startAt.setHours(8 + Math.floor(rand() * 3), 0, 0, 0);
  else startAt.setHours(13 + Math.floor(rand() * 2), 0, 0, 0);
  const durationHours = 1 + Math.floor(rand() * 3);
  const endAt = new Date(startAt.getTime() + durationHours * 60 * 60 * 1000);
  // 15 % long trips.
  const distance = rand() < 0.15 ? 500 + Math.floor(rand() * 200) : 50 + Math.floor(rand() * 200);

  const sameDay = allBookings.filter((b) => b.day === ymd);
  const existing: ExistingTrip[] = sameDay.map((b) => ({
    vehicleId: b.vehicleId,
    timeBucket: b.timeBucket,
  }));
  const onCallDriverId = onCallFor(ymd);

  const busyToday: DriverBusyTrip[] = [];
  for (const b of sameDay) {
    busyToday.push({ driverId: b.primaryDriverId, jobType: b.jobType });
    if (b.secondaryDriverId) busyToday.push({ driverId: b.secondaryDriverId, jobType: b.jobType });
  }
  busyToday.push({ driverId: onCallDriverId, jobType: "WERN" });

  // Per-driver temporal trip list (CR-06 cap check).
  const tripsByDriver = new Map<string, TripWindow[]>();
  for (const d of drivers) tripsByDriver.set(d.id, []);
  for (const b of sameDay) {
    tripsByDriver.get(b.primaryDriverId)!.push({ startAt: b.startAt, endAt: b.endAt });
    if (b.secondaryDriverId) tripsByDriver.get(b.secondaryDriverId)!.push({ startAt: b.startAt, endAt: b.endAt });
  }
  // Duty driver pseudo-trip blocking morning + afternoon.
  const dutyStart = new Date(day);
  dutyStart.setHours(8, 0, 0, 0);
  const dutyEnd = new Date(day);
  dutyEnd.setHours(16, 0, 0, 0);
  tripsByDriver.get(onCallDriverId)!.push({ startAt: dutyStart, endAt: dutyEnd });

  const slotTable = buildSlotTable(VEHICLES, existing);
  const driverInputs: DriverInput[] = drivers.map((d) => ({
    driverId: d.id,
    joinedAt: d.joinedAt,
    lastAssignedAt: d.lastAssignedAt,
  }));
  const driverMatrix = buildDriverMatrix(driverInputs, busyToday);
  const driverAvailability: DriverAvailabilityInput[] = drivers.map((d) => ({
    driverId: d.id,
    existing: tripsByDriver.get(d.id) ?? [],
  }));
  const rankInputs: RankInput[] = drivers.map((d) => ({
    driverId: d.id,
    earningsScore: d.earnings,
    tripsThisMonth: d.tripsThisMonth,
    lastAssignedAt: d.lastAssignedAt,
  }));

  const result = match({
    jobType,
    timeBucket: bucket,
    newTrip: { startAt, endAt },
    estimatedDistance: distance,
    slotTable,
    driverMatrix,
    driverAvailability,
    driverRankInputs: rankInputs,
  });

  if (!result.ok) {
    outcomes.push({ ok: false, reason: result.error });
    escalated += 1; // every miss would in prod escalate to Khun Top
    continue;
  }
  outcomes.push({ ok: true });

  const primary = drivers.find((d) => d.id === result.result.primaryDriverId)!;
  primary.earnings += 1;
  primary.tripsThisMonth += 1;
  primary.byJobType[jobType] += 1;
  primary.lastAssignedAt = day;
  let secondaryDriverId: string | null = null;
  if (result.result.secondaryDriverId) {
    const sec = drivers.find((d) => d.id === result.result.secondaryDriverId)!;
    sec.earnings += 1;
    sec.tripsThisMonth += 1;
    sec.byJobType[jobType] += 1;
    sec.lastAssignedAt = day;
    secondaryDriverId = sec.id;
  }
  allBookings.push({
    bookingId: `b${i}`,
    day: ymd,
    vehicleId: result.result.vehicleId,
    timeBucket: bucket,
    jobType,
    startAt,
    endAt,
    primaryDriverId: primary.id,
    secondaryDriverId,
  });
  // Stamp on-call days into the driver's count too so fairness sees them.
  // (Real prod uses a real OnCallShift table; here we approximate.)
  const onCallDriver = drivers.find((d) => d.id === onCallDriverId)!;
  onCallDriver.byJobType.WERN = Math.max(onCallDriver.byJobType.WERN, onCallByDay.size);
}

const matched = outcomes.filter((o) => o.ok).length;
const failed = outcomes.filter((o) => !o.ok) as Array<{ ok: false; reason: string }>;
const failByReason = new Map<string, number>();
for (const f of failed) failByReason.set(f.reason, (failByReason.get(f.reason) ?? 0) + 1);

console.log(`\nCR-06 Simulation: ${TOTAL_BOOKINGS} bookings, seed=${SEED}\n`);
console.log(`matched:  ${matched}/${TOTAL_BOOKINGS}  (${((matched / TOTAL_BOOKINGS) * 100).toFixed(1)}%)`);
console.log(`failed:   ${failed.length} (would escalate to Khun Top)`);
for (const [reason, n] of failByReason.entries()) {
  console.log(`  · ${reason}: ${n}`);
}

console.log("\nper-driver trips (excl. duty-day rounds):");
const widest = Math.max(...drivers.map((d) => d.earnings));
for (const d of drivers) {
  const bar = "█".repeat(Math.round((d.earnings / Math.max(widest, 1)) * 30));
  const bd = `GEN=${d.byJobType.NORMAL} OT=${d.byJobType.OT} OOP=${d.byJobType.TJW}`;
  console.log(`  ${d.name.padEnd(8)} ${String(d.earnings).padStart(3)}  ${bar.padEnd(30)}  ${bd}`);
}

const counts = drivers.map((d) => d.earnings);
const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
const variance = counts.reduce((sum, c) => sum + (c - avg) ** 2, 0) / counts.length;
const stddev = Math.sqrt(variance);
console.log(`\nfairness: mean=${avg.toFixed(2)}  stddev=${stddev.toFixed(2)}  spread=${Math.max(...counts) - Math.min(...counts)}`);

// Spot-check: anyone exceeded the 1/day cap?
let capViolations = 0;
const byDriverDay = new Map<string, number>();
for (const b of allBookings) {
  const k = `${b.primaryDriverId}::${b.day}`;
  byDriverDay.set(k, (byDriverDay.get(k) ?? 0) + 1);
  if (b.secondaryDriverId) {
    const k2 = `${b.secondaryDriverId}::${b.day}`;
    byDriverDay.set(k2, (byDriverDay.get(k2) ?? 0) + 1);
  }
}
for (const v of byDriverDay.values()) if (v > 2) capViolations += 1;
console.log(`cap check: ${capViolations} driver-days exceeded 2 trips (should be 0)`);
console.log(`(lower stddev/spread = fairer distribution across drivers)\n`);
