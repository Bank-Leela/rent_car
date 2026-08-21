// CR-07 — daily batch driver assignment.
//
// Inputs: the day's bookings (with FCFS submittedAt), the driver pool with
// rotation timestamps, the day's duty driver, and TJW commitments that
// span this day.
//
// Output: a primary (+ optional secondary) driver assignment per booking,
// or an `OverflowReason` if no fit. The solver is **pure** — it reads its
// inputs, decides, and returns. Persistence (provisional rotation stamping,
// AuditLog rows, booking writes) happens in matching-actions.ts.
//
// Defaults (per client clarification — supersedes the open question in the
// change log):
//   fcfsOverridesCategoryPriority = false → categories are resolved in
//     strict priority order: TJW → OT → WERN → NORMAL. FCFS applies only
//     inside each category. NORMAL fills the remaining slots after the
//     other three are placed. When the flag is true (override), all
//     bookings are processed in a single FCFS pass.
//   wernReclaimPolicy                   → when a >400 km trip can only be
//     staffed by reclaiming today's duty driver as the co-driver:
//       ESCALATE (default) → surface NEEDS_WERN_RECLAIM_DECISION to Khun Top.
//       AUTO_RECLAIM       → take the duty driver automatically.
//       PROTECT_WERN       → never reclaim; overflow NO_SECONDARY_DRIVER.
//
// Phases:
//   - Per-booking primary pick using its category's rotation (rankForRotation):
//       TJW    → oldest Driver.lastTjwAt
//       WERN   → OnCallShift if set, else pickDutyRotation (oldest lastDutyAt)
//       OT     → oldest Driver.lastOtAt
//       NORMAL → pickGeneralRank with coverage rule (everyone ≥1 before 2)
//   - >400 km secondary pick from the remaining pool, same rotation.
//   - Phase C sweep: OT trips that overflowed are retried against drivers
//     returning from TJW today before the 16:00 cutoff.

import type { JobType, OverflowReason } from "@prisma/client";
import { tripEffort, WORK_DAY_END_HOUR, LONG_TRIP_KM } from "./classification";
import {
  canTake,
  MAX_JOBS_PER_DAY,
  pickGeneralRank,
  pickDutyRotation,
  rankForRotation,
  type DriverRotationState,
  type ScheduledTrip,
} from "./rotations";

export { LONG_TRIP_KM };

/**
 * PreferredVehicleType (requester's category) → VehicleType (owned-fleet class).
 * null = nothing in the fleet can satisfy it: a bus is always outsourced, so a
 * BUS_OUTSOURCED preference must not narrow the internal pick at all.
 */
const FLEET_TYPE_FOR_PREFERENCE: Record<string, string | null> = {
  VAN: "VAN",
  PICKUP: "PICKUP",
  SEDAN_DEAN: "SEDAN",
  TRUCK_6_WHEEL: "OTHER",
  BUS_OUTSOURCED: null,
};

export interface SolverBookingInput {
  bookingId: string;
  jobType: JobType;
  startAt: Date;
  endAt: Date;
  estimatedDistance: number | null;
  /** Admin's manual "needs a co-driver" flag — triggers pairing even when
   *  estimatedDistance is null (Maps is env-gated, so distance is usually unset). */
  needsSecondaryDriver?: boolean;
  /**
   * The category the requester asked for (รถตู้ / เก๋ง / กระบะ …). A PREFERENCE,
   * never a filter: the fleet is small, and refusing to place a trip because the
   * one free car is the wrong shape would leave it unassigned over a detail the
   * office routinely works around. See the two-pass pick below.
   */
  preferredVehicleType?: string | null;
  /** In-Chula campus errand — eligible to share a car with another one (§5c). */
  travelWithinChula?: boolean;
  outOfProvince: boolean;
  /** FCFS key; defaults to createdAt. */
  submittedAt: Date;
  // No-wait split fields (optional; absent ⇒ single interval).
  waitAtDestination?: boolean;
  dropOffDone?: Date | null;
  pickupReturnTime?: string | null;
}

export interface TjwCommitment {
  driverId: string;
  startAt: Date;
  endAt: Date;
}

export interface SolverInput {
  date: Date;
  bookings: SolverBookingInput[];
  drivers: DriverRotationState[];
  dutyDriverId: string | null;
  activeTjwCommitments: TjwCommitment[];
  /** Trips already assigned to each driver for this day (any job type),
   *  keyed by driverId. Seeds each driver's `scheduledToday` so the overlap /
   *  daily-cap rules see prior commitments — without this the solver would
   *  stack a second trip on an already-booked car. */
  existingByDriver?: Map<string, ScheduledTrip[]>;
  config?: SolverConfig;
}

export interface SolverConfig {
  fcfsOverridesCategoryPriority?: boolean;
  wernReclaimPolicy?: "ESCALATE" | "AUTO_RECLAIM" | "PROTECT_WERN";
}

export interface SolverAssignment {
  bookingId: string;
  primaryDriverId: string;
  secondaryDriverId: string | null;
  jobType: JobType;
}

export interface SolverOverflow {
  bookingId: string;
  reason: OverflowReason;
}

export interface SolverOutput {
  assignments: SolverAssignment[];
  overflows: SolverOverflow[];
  driverDay: Map<string, ScheduledTrip[]>;
}

interface MutableDriver extends DriverRotationState {
  scheduledToday: ScheduledTrip[];
  /** car=driver, so this is the type of the car this driver brings. */
  vehicleType?: string | null;
  /** Locked away on a TJW that hasn't returned yet. */
  awayOnTjw: boolean;
  /** TJW commitment returns today before WORK_DAY_END_HOUR; Phase-C
   *  eligible for OT only. */
  isTjwReturneeOtEligible: boolean;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function spansDay(commitment: TjwCommitment, day: Date): boolean {
  return commitment.startAt <= endOfDay(day) && commitment.endAt >= startOfDay(day);
}
function returnsBeforeCutoffToday(commitment: TjwCommitment, day: Date): boolean {
  return sameDay(commitment.endAt, day) && commitment.endAt.getHours() < WORK_DAY_END_HOUR;
}

export function solveDay(input: SolverInput): SolverOutput {
  const config: Required<SolverConfig> = {
    fcfsOverridesCategoryPriority: input.config?.fcfsOverridesCategoryPriority ?? false,
    wernReclaimPolicy: input.config?.wernReclaimPolicy ?? "ESCALATE",
  };

  const drivers: MutableDriver[] = input.drivers.map((d) => {
    const commitment = input.activeTjwCommitments.find((c) => c.driverId === d.driverId);
    const returneeToday = !!commitment && returnsBeforeCutoffToday(commitment, input.date);
    const stillAway = !!commitment && spansDay(commitment, input.date) && !returneeToday;
    // Copy so the solver's own pushes never mutate the caller's array.
    const existing = input.existingByDriver?.get(d.driverId);
    return {
      ...d,
      scheduledToday: existing ? [...existing] : [],
      awayOnTjw: stillAway,
      isTjwReturneeOtEligible: returneeToday,
    };
  });

  // Order: FCFS globally when flag is true; per-category order otherwise.
  let order: SolverBookingInput[];
  if (config.fcfsOverridesCategoryPriority) {
    order = [...input.bookings].sort(
      (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime(),
    );
  } else {
    const fc = (cat: JobType) =>
      [...input.bookings.filter((b) => b.jobType === cat)].sort(
        (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime(),
      );
    order = [...fc("TJW"), ...fc("OT"), ...fc("WERN"), ...fc("NORMAL")];
  }

  const assignments: SolverAssignment[] = [];
  const overflows: SolverOverflow[] = [];
  const otOverflows: SolverBookingInput[] = [];

  for (const booking of order) {
    const result = placeBooking(drivers, booking, input.dutyDriverId, /* phaseC */ false, config.wernReclaimPolicy);
    if (result.kind === "ok") {
      commitAssignment(drivers, booking, result.primaryDriverId, result.secondaryDriverId);
      assignments.push({
        bookingId: booking.bookingId,
        primaryDriverId: result.primaryDriverId,
        secondaryDriverId: result.secondaryDriverId,
        jobType: booking.jobType,
      });
      continue;
    }
    // Only NO_PRIMARY_DRIVER on an OT trip is rescuable by Phase C; reclaim
    // escalation and missing-secondary failures must surface directly.
    if (booking.jobType === "OT" && result.reason === "NO_PRIMARY_DRIVER") {
      otOverflows.push(booking);
      continue;
    }
    overflows.push({ bookingId: booking.bookingId, reason: result.reason });
  }

  // Phase C: retry OT overflows against TJW returnees.
  for (const booking of otOverflows) {
    const result = placeBooking(drivers, booking, input.dutyDriverId, /* phaseC */ true, config.wernReclaimPolicy);
    if (result.kind === "ok") {
      commitAssignment(drivers, booking, result.primaryDriverId, result.secondaryDriverId);
      assignments.push({
        bookingId: booking.bookingId,
        primaryDriverId: result.primaryDriverId,
        secondaryDriverId: result.secondaryDriverId,
        jobType: booking.jobType,
      });
      continue;
    }
    overflows.push({ bookingId: booking.bookingId, reason: result.reason });
  }

  const driverDay = new Map<string, ScheduledTrip[]>();
  for (const d of drivers) driverDay.set(d.driverId, d.scheduledToday);

  return { assignments, overflows, driverDay };
}

// ---- placement primitives ----

type PlaceResult =
  | { kind: "ok"; primaryDriverId: string; secondaryDriverId: string | null }
  | { kind: "fail"; reason: OverflowReason };

function placeBooking(
  drivers: MutableDriver[],
  booking: SolverBookingInput,
  dutyDriverId: string | null,
  phaseC: boolean,
  wernReclaimPolicy: Required<SolverConfig>["wernReclaimPolicy"],
): PlaceResult {
  // A WERN (duty) slot belongs to the day's on-call driver (docs §1 + this file's
  // header §WERN: "OnCallShift if set"). eligibleForPrimary reserves the duty
  // driver out of every pick, so route WERN to them explicitly; if they can't
  // take it (away / overlap) or none is rostered, fall through to the duty
  // rotation below.
  if (booking.jobType === "WERN" && dutyDriverId) {
    // ...but only if they're fully available today. A driver still away on a TJW
    // (awayOnTjw) or one that only returned mid-day (isTjwReturneeOtEligible —
    // away through the morning) can't run the campus-rounds window, so the WERN
    // falls through to the duty rotation below.
    const duty = drivers.find(
      (d) =>
        d.driverId === dutyDriverId &&
        !d.awayOnTjw &&
        !d.isTjwReturneeOtEligible &&
        canDriverTakeNew(drivers, dutyDriverId, booking),
    );
    if (duty) return { kind: "ok", primaryDriverId: dutyDriverId, secondaryDriverId: null };
  }

  // Primary candidates depend on category.
  const primaryEligible = eligibleForPrimary(drivers, booking, dutyDriverId, phaseC);
  const primaryRanked = rankForCategory(primaryEligible, booking.jobType, drivers);
  // Requested vehicle type, applied as FIRST CHOICE and nothing stronger: walk
  // the fairness order once considering only cars of the right type, then walk
  // the same order again with no type condition.
  //
  // Two passes rather than a sort key, so fairness is untouched INSIDE each
  // pass — the fairest matching car wins, and when none exists the fairest car
  // of any type does. A filter would have been wrong here: the fleet is six
  // cars, and leaving a trip unassigned because the only free one is a เก๋ง
  // rather than a ตู้ trades a real problem for a cosmetic one. Nothing before
  // this read the requester's choice at all — it was stored and never consulted.
  // §5b compares a PreferredVehicleType (what the requester asked for) against a
  // VehicleType (what the fleet physically is). They are two different enums that
  // happen to share VAN and PICKUP, so those two worked by coincidence while
  // SEDAN_DEAN and TRUCK_6_WHEEL could never match anything and the preference was
  // silently dead for them. Translate instead of comparing raw strings.
  const wanted = FLEET_TYPE_FOR_PREFERENCE[booking.preferredVehicleType ?? ""] ?? null;
  const typeMatches = (id: string) =>
    !wanted || drivers.find((d) => d.driverId === id)?.vehicleType === wanted;
  const primaryId =
    primaryRanked.find((id) => typeMatches(id) && canDriverTakeNew(drivers, id, booking)) ??
    primaryRanked.find((id) => canDriverTakeNew(drivers, id, booking)) ??
    null;
  if (!primaryId) {
    return { kind: "fail", reason: "NO_PRIMARY_DRIVER" };
  }

  const long =
    booking.needsSecondaryDriver ||
    (booking.estimatedDistance !== null && booking.estimatedDistance > LONG_TRIP_KM);
  if (!long) {
    return { kind: "ok", primaryDriverId: primaryId, secondaryDriverId: null };
  }

  // Secondary candidates: same eligibility minus primary.
  const secondaryEligible = eligibleForPrimary(drivers, booking, dutyDriverId, phaseC).filter(
    (d) => d.driverId !== primaryId,
  );
  const secondaryRanked = rankForCategory(secondaryEligible, booking.jobType, drivers);
  const secondaryId = secondaryRanked.find((id) => canDriverTakeNew(drivers, id, booking));
  if (secondaryId) {
    return { kind: "ok", primaryDriverId: primaryId, secondaryDriverId: secondaryId };
  }

  // No fresh secondary. If the duty driver can't even fit, it's a plain
  // NO_SECONDARY_DRIVER regardless of policy.
  const duty = drivers.find(
    (d) => d.driverId === dutyDriverId &&
      !d.awayOnTjw &&
      canTake(
        {
          startAt: booking.startAt,
          endAt: booking.endAt,
          jobType: booking.jobType,
          travelWithinChula: booking.travelWithinChula,
          waitAtDestination: booking.waitAtDestination,
          dropOffDone: booking.dropOffDone,
          pickupReturnTime: booking.pickupReturnTime,
        },
        d.scheduledToday,
      ),
  );
  if (!duty) return { kind: "fail", reason: "NO_SECONDARY_DRIVER" };

  // The duty driver could be reclaimed as the co-driver. What happens is the
  // wernReclaimPolicy (docs §6b):
  //   ESCALATE (default) → raise the decision for P'Top (RECLAIM_WERN / OUTSOURCE).
  //   AUTO_RECLAIM       → take the duty driver now (commitAssignment locks them
  //                        away for a TJW span, abandoning duty rounds — the point).
  //   PROTECT_WERN       → never reclaim; overflow NO_SECONDARY_DRIVER instead.
  switch (wernReclaimPolicy) {
    case "AUTO_RECLAIM":
      return { kind: "ok", primaryDriverId: primaryId, secondaryDriverId: duty.driverId };
    case "PROTECT_WERN":
      return { kind: "fail", reason: "NO_SECONDARY_DRIVER" };
    default:
      return { kind: "fail", reason: "NEEDS_WERN_RECLAIM_DECISION" };
  }
}

function eligibleForPrimary(
  drivers: MutableDriver[],
  booking: SolverBookingInput,
  dutyDriverId: string | null,
  phaseC: boolean,
): MutableDriver[] {
  return drivers.filter((d) => {
    if (d.awayOnTjw) return false;
    if (d.driverId === dutyDriverId) return false;
    // Cap is on NORMAL day-jobs only; OT is extra hours, never pre-excluded here
    // (canChain still gates the exact gap/cap when the trip is placed).
    if (booking.jobType === "NORMAL" && d.scheduledToday.filter((t) => t.jobType === "NORMAL").length >= MAX_JOBS_PER_DAY) {
      return false;
    }
    if (phaseC) {
      // Phase C only sees TJW returnees.
      if (!d.isTjwReturneeOtEligible) return false;
    } else {
      // Non-phase-C never uses a returnee for primary.
      if (d.isTjwReturneeOtEligible) return false;
    }
    return true;
  });
}

function rankForCategory(
  pool: MutableDriver[],
  jobType: JobType,
  allDrivers: MutableDriver[],
): string[] {
  if (jobType === "TJW") return rankForRotation(pool, (d) => d.lastTjwAt);
  if (jobType === "OT") return rankForRotation(pool, (d) => d.lastOtAt);
  if (jobType === "WERN") return pickDutyRotation(pool) ? rankForRotation(pool, (d) => d.lastDutyAt) : [];
  // NORMAL: coverage rule (everyone ≥1 before any gets 2). Count NORMAL
  // day-jobs only — OT is extra hours on top and must not push a driver out of
  // the NORMAL pick (matches the NORMAL-only cap pre-filter in eligibleForPrimary).
  const normalCount = (id: string) =>
    allDrivers.find((x) => x.driverId === id)!.scheduledToday.filter((t) => t.jobType === "NORMAL").length;
  const ranked = pickGeneralRank(pool);
  const tier0 = ranked.filter((id) => normalCount(id) === 0);
  const tier1 = ranked.filter((id) => normalCount(id) === 1);
  return [...tier0, ...tier1];
}

function canDriverTakeNew(
  drivers: MutableDriver[],
  driverId: string,
  booking: SolverBookingInput,
): boolean {
  const d = drivers.find((x) => x.driverId === driverId)!;
  return canTake(
        {
          startAt: booking.startAt,
          endAt: booking.endAt,
          jobType: booking.jobType,
          // Without this the pairing exemption can never fire: sharesCarWith
          // needs the flag on BOTH sides.
          travelWithinChula: booking.travelWithinChula,
          waitAtDestination: booking.waitAtDestination,
          dropOffDone: booking.dropOffDone,
          pickupReturnTime: booking.pickupReturnTime,
        },
        d.scheduledToday,
      );
}

function commitAssignment(
  drivers: MutableDriver[],
  booking: SolverBookingInput,
  primaryId: string,
  secondaryId: string | null,
) {
  commitTrip(drivers, primaryId, booking);
  if (secondaryId) commitTrip(drivers, secondaryId, booking);

  // TJW locks both drivers away for the remaining span of the trip.
  if (booking.jobType === "TJW") {
    drivers.find((d) => d.driverId === primaryId)!.awayOnTjw = true;
    if (secondaryId) drivers.find((d) => d.driverId === secondaryId)!.awayOnTjw = true;
  }
}

function commitTrip(drivers: MutableDriver[], driverId: string, booking: SolverBookingInput) {
  const d = drivers.find((x) => x.driverId === driverId)!;
  d.scheduledToday.push({
    id: booking.bookingId,
    startAt: booking.startAt,
    endAt: booking.endAt,
    jobType: booking.jobType,
    travelWithinChula: booking.travelWithinChula,
    waitAtDestination: booking.waitAtDestination,
    dropOffDone: booking.dropOffDone,
    pickupReturnTime: booking.pickupReturnTime,
  });
  d.earningsScore += tripEffort(booking.jobType, booking.startAt, booking.endAt);
  // Provisional rotation stamping, as docs/scheduling-algorithm.md §6 has always
  // claimed the solver does. It did not, and nothing caught it: rankForCategory
  // sorts on these stamps, so within ONE solve the same driver stayed at the head
  // of the queue and took every OT of the day. The rule-check counters in
  // scripts/simulate-cr07.ts only measure legality (gap, cap, overlap) — three OTs
  // on one driver two hours apart is perfectly legal and perfectly unfair, so the
  // CI gate stayed green over it. Proven with solveDay directly: three same-day
  // OTs, three drivers, all three went to the same driver.
  //
  // Only the in-memory copy moves. The durable write still happens once per day in
  // batch-core, so a bump here can never outlive a solve that is thrown away.
  if (booking.jobType === "TJW") d.lastTjwAt = booking.startAt;
  else if (booking.jobType === "OT") d.lastOtAt = booking.startAt;
  else if (booking.jobType === "WERN") d.lastDutyAt = booking.startAt;
  d.lastAssignedAt = booking.startAt;
}
