import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sharesCarWith } from "@/lib/booking/rotations";
import { legsOverlap, type LegSource } from "@/lib/booking/trip-legs";

/**
 * The app-level half of the no-double-book rule (§5), and the ONLY thing bounding
 * the §5c in-Chula exception.
 *
 * §5c lets two campus errands starting within ten minutes of each other share one
 * car. Postgres enforces the exception but cannot enforce its BOUND: the two
 * exclusion constraints are `WHERE (NOT "inChula")` and `"inChula" WITH <>`, so a
 * pair of in-Chula rows matches neither — at ANY start distance. Two campus
 * errands six hours apart were accepted onto one car, which no rule permits.
 * An EXCLUDE cannot express "conflict unless the starts are close", so the window
 * has to live here.
 *
 * That makes this function load-bearing rather than advisory, which is why it is
 * one function: the same scan was written inline in reassignVehicleAction while
 * the two automatic dispatch paths had no equivalent at all — and those are
 * exactly the paths that can commit a car with no driver, which every
 * driver-keyed capacity check skips.
 */
export type VehicleConflict = { destination: string; startAt: Date; endAt: Date };

type Candidate = LegSource & {
  destination: string;
  travelWithinChula: boolean;
};

const CANDIDATE_SELECT = {
  destination: true,
  startAt: true,
  endAt: true,
  travelWithinChula: true,
  waitAtDestination: true,
  dropOffDone: true,
  pickupReturnTime: true,
} satisfies Prisma.BookingSelect;

/** Only the window is required; the no-wait split fields default to one leg. */
export type LegInput = Partial<LegSource> & { startAt: Date; endAt: Date };

const toLeg = (b: LegInput): LegSource => ({
  startAt: b.startAt,
  endAt: b.endAt,
  waitAtDestination: b.waitAtDestination ?? true,
  dropOffDone: b.dropOffDone ?? null,
  pickupReturnTime: b.pickupReturnTime ?? null,
});

/**
 * Trips already committed to `vehicleId` that the given window may not share it
 * with. Empty means the placement is legal.
 *
 * Status list matches the occupancy trigger (APPROVED | ASSIGNED | COMPLETED).
 * Dropping COMPLETED would let the caller past a finished trip that still holds
 * an occupancy row, and the EXCLUDE would then reject the write with an unnamed
 * error instead of a conflict this can name.
 */
export async function findVehicleConflicts(
  booking: LegInput & { id?: string; travelWithinChula?: boolean },
  vehicleId: string,
  tx?: Prisma.TransactionClient,
): Promise<VehicleConflict[]> {
  const client = tx ?? prisma;
  const candidates = (await client.booking.findMany({
    where: {
      ...(booking.id ? { id: { not: booking.id } } : {}),
      vehicleId,
      status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
      startAt: { lt: booking.endAt },
      endAt: { gt: booking.startAt },
    },
    orderBy: { startAt: "asc" },
    select: CANDIDATE_SELECT,
  })) as Candidate[];

  const own = toLeg(booking);
  return candidates
    .filter((c) => !sharesCarWith(booking, c))
    .filter((c) => legsOverlap(own, toLeg(c)))
    .slice(0, 3)
    .map((c) => ({ destination: c.destination, startAt: c.startAt, endAt: c.endAt }));
}
