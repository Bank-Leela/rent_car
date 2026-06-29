import { startOfDay } from "date-fns";
import type { JobType } from "@prisma/client";
import { LONG_TRIP_KM } from "./classification";

// Seeded random generator for the 30-day fuzz simulation. Pure (no DB). Produces
// schema-VALID booking specs with random distribution/volume/edges so the sim can
// surface real overflows and rule violations — not a curated happy path. Same seed
// → same month (reproducible). The DB plumbing lives in batch-demo-actions.

// mulberry32 — the same seeded RNG technique simulate-cr07 uses.
export function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratedBooking {
  dayIndex: number;
  jobType: JobType;
  startAt: Date;
  endAt: Date;
  province: string;
  outOfProvince: boolean;
  estimatedDistance: number;
  passengerCount: number;
  maleCount: number;
  femaleCount: number;
  waitAtDestination: boolean;
  dropOffDone: Date | null;
  pickupReturnTime: string | null;
  createdAt: Date;
  purpose: string;
  destination: string;
}

const BKK = "กรุงเทพมหานคร";
const OUT_PROVINCES = ["เชียงใหม่", "ขอนแก่น", "ภูเก็ต", "นครราชสีมา", "สงขลา", "นครปฐม"];
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * Random month of bookings. Per day a random count (sometimes over the ~11/day
 * capacity → forces overflow). Each booking: weighted random jobType, random
 * times/duration/distance/passengers, ตจว always overnight + out-of-province, and
 * a random ~25% of same-day NORMAL/OT trips made no-wait with a valid same-day
 * leg split. Request dates (createdAt) precede + are shuffled vs the trip date.
 */
export function generateRandomDemoBookings(start: Date, days: number, seed: number): GeneratedBooking[] {
  const rand = rng(seed);
  const ri = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)]!;
  const chance = (p: number) => rand() < p;

  const day0 = startOfDay(start);
  const out: GeneratedBooking[] = [];

  for (let d = 0; d < days; d++) {
    const count = ri(2, 13); // ceiling > capacity on purpose
    for (let i = 0; i < count; i++) {
      const roll = rand();
      const jobType: JobType = roll < 0.15 ? "TJW" : roll < 0.4 ? "OT" : roll < 0.52 ? "WERN" : "NORMAL";

      const startAt = new Date(day0);
      startAt.setDate(startAt.getDate() + d);
      let endAt: Date;
      let province = BKK;
      let outOfProvince = false;
      let estimatedDistance = ri(5, 180);
      let waitAtDestination = true;
      let dropOffDone: Date | null = null;
      let pickupReturnTime: string | null = null;

      if (jobType === "TJW") {
        // Overnight, out-of-province (required to classify as ตจว).
        startAt.setHours(ri(5, 9), 0, 0, 0);
        endAt = new Date(startAt);
        endAt.setDate(endAt.getDate() + ri(1, 3));
        endAt.setHours(ri(15, 19), 0, 0, 0);
        outOfProvince = true;
        province = pick(OUT_PROVINCES);
        estimatedDistance = ri(300, 750);
      } else {
        // Same-day. OT skews to the 5/6 and 17/18 edges sometimes.
        const sh = jobType === "OT" && chance(0.5) ? pick([5, 6, 17, 18]) : ri(7, 16);
        const dur = ri(2, Math.min(6, Math.max(2, 22 - sh))); // end ≤ 22:00, same day
        startAt.setHours(sh, 0, 0, 0);
        endAt = new Date(startAt.getTime() + dur * 3_600_000);
        if (chance(0.25)) {
          outOfProvince = true;
          province = pick(OUT_PROVINCES);
          estimatedDistance = ri(60, 250);
        }
        if (jobType === "OT" && chance(0.2)) estimatedDistance = ri(LONG_TRIP_KM + 20, 700); // co-driver path
        // ~25% no-wait when the span is long enough to hold a valid leg split.
        if ((jobType === "NORMAL" || jobType === "OT") && dur >= 5 && sh <= 16 && chance(0.25)) {
          waitAtDestination = false;
          dropOffDone = new Date(startAt.getTime() + 2 * 3_600_000); // start + 2h
          const ret = new Date(endAt.getTime() - 2 * 3_600_000); // end − 2h
          pickupReturnTime = hhmm(ret); // start < dropOff < return < end, same day
        }
      }

      const createdAt = new Date(startAt);
      createdAt.setDate(createdAt.getDate() - ri(3, 30)); // request before trip, varied
      createdAt.setHours(9 + (i % 6), 0, 0, 0);

      out.push({
        dayIndex: d,
        jobType,
        startAt,
        endAt,
        province,
        outOfProvince,
        estimatedDistance,
        passengerCount: ri(1, 6),
        maleCount: ri(0, 3),
        femaleCount: ri(0, 3),
        waitAtDestination,
        dropOffDone,
        pickupReturnTime,
        createdAt,
        purpose: `${jobType} random d${d}-${i}`,
        destination: `${province} site ${i}`,
      });
    }
  }
  return out;
}
