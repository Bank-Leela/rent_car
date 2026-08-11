import { startOfDay } from "date-fns";
import type { JobType, PreferredVehicleType } from "@prisma/client";
import { recommendForBookings } from "@/lib/booking/placement-reco-data";

/**
 * "Can the fleet actually serve this trip on its day?" — asked at approval.
 *
 * Approving used to say nothing about capacity. The submit-time gate
 * (`slot-capacity.ts`) counts slots when the REQUEST is made and WAITLISTs the
 * overflow, but by the time P'Top decides, the day has moved: trips were
 * assigned, cancelled, or a driver went off sick. So approval asked the real
 * question of a stale answer, or of no answer at all.
 *
 * This asks the placement engine the same question จัด will ask — respecting the
 * 2 h gap, the NORMAL morning+afternoon cap, overlap and the เวร reservation —
 * rather than re-deriving a coarse count. A trip that cannot be placed is
 * "full"; what happens next depends on whether the requester accepted an
 * outside rental (see approveBookingAction).
 *
 * NOT a reservation. Two bookings approved into the same free slot will both
 * read as fitting, because neither holds a driver until จัด runs. The gate is a
 * decision aid at approval; the solver remains the authority.
 */
export type CapacityVerdict = {
  /** false = this kind never goes through จัด, so "full" is not a question about it. */
  gated: boolean;
  /** Whether a legal car exists for this trip on its day. True when not gated. */
  fits: boolean;
};

export type Candidate = {
  id: string;
  startAt: Date;
  endAt: Date;
  estimatedDistance: number | null;
  jobType: JobType;
  isEmergency: boolean;
  preferredVehicleType: PreferredVehicleType | null;
};

/**
 * Kinds the fleet-capacity question does not apply to. Getting this list wrong
 * is worse than having no gate: `recommendPlacement` returns `none` for WERN by
 * design (the duty car serves it, it is never placed by the recommender), so a
 * naive gate would refuse every in-Chula booking as "day full".
 */
function skipsCapacityGate(b: Candidate): boolean {
  return (
    b.jobType === "WERN" || // the เวร driver serves it; never placed by the recommender
    b.jobType === "TJW" || // placed by the TJW request solver, not solveDay
    b.jobType === "SMUS" || // external charter — never touches the internal fleet
    b.isEmergency || // จองเร่งด่วน is deliberately manual
    b.preferredVehicleType === "BUS_OUTSOURCED" // always an outside rental
  );
}

export async function dayHasRoomFor(booking: Candidate): Promise<CapacityVerdict> {
  const verdicts = await dayHasRoomForMany([booking]);
  return verdicts.get(booking.id) ?? { gated: false, fits: true };
}

/**
 * The same question for a whole queue at once.
 *
 * The approver queue shows a "day full" chip on every pending card, and asking
 * per card would be one placement solve per card. `recommendForBookings` already
 * takes a list and loads the day's drivers and trips ONCE, so grouping by day
 * costs one round of queries per distinct day instead of per booking.
 *
 * Same caveat as the single version: each booking is judged against the day as
 * it stands, not against the other pending ones. Two cards on a day with one
 * free car will both read as fitting, because neither holds a driver until จัด
 * runs. That is the honest answer to "could this be served?" — it is the solver,
 * not this, that decides who actually gets the car.
 */
export async function dayHasRoomForMany(
  bookings: readonly Candidate[],
): Promise<Map<string, CapacityVerdict>> {
  const out = new Map<string, CapacityVerdict>();
  const byDay = new Map<number, Candidate[]>();

  for (const b of bookings) {
    if (skipsCapacityGate(b)) {
      out.set(b.id, { gated: false, fits: true });
      continue;
    }
    const key = startOfDay(b.startAt).getTime();
    const group = byDay.get(key) ?? [];
    group.push(b);
    byDay.set(key, group);
  }

  for (const [dayMs, group] of byDay) {
    const recos = await recommendForBookings(
      new Date(dayMs),
      group.map((b) => ({
        id: b.id,
        startAt: b.startAt,
        endAt: b.endAt,
        estimatedDistance: b.estimatedDistance,
        jobType: b.jobType,
      })),
      true,
    );
    for (const b of group) {
      const placement = recos.get(b.id);
      // `reclaim` means a car DOES exist — the duty car — and pulling it is
      // P'Top's call, handled by the existing NEEDS_WERN_RECLAIM_DECISION flow.
      // Only `none` means the fleet genuinely cannot serve this trip.
      out.set(b.id, { gated: true, fits: !!placement && placement.kind !== "none" });
    }
  }

  return out;
}
