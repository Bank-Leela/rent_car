// Placement recommendation for a leftover (overflowed / unassigned) booking —
// the suggestion P'Top sees when the auto-solver couldn't place a trip. Pure;
// no I/O. The fairness order matches the solver/matcher (earnings ↑, then
// lastAssignedAt ↑). The 2-job/day cap is intentionally NOT applied: this is a
// manual override, so any non-duty car whose driver is free at the trip's time
// (no overlapping trip) is fair game. If none is free, fall back to the duty
// car — the only car allowed to overlap. For a >400 km trip a co-driver is also
// recommended: the next-fairest free non-duty driver (rides in the primary's
// car), or null when none is free.

export interface RecoDriver {
  driverId: string;
  /** Assigned car (car=driver). null = unpaired → not recommendable. */
  vehicleId: string | null;
  registrationNumber: string | null;
  driverName: string | null;
  earningsScore: number;
  lastAssignedAt: Date | null;
  /** The driver's other committed trips that day (to check time overlap). */
  trips: Array<{ startAt: Date; endAt: Date }>;
}

export interface RecoInput {
  booking: { startAt: Date; endAt: Date };
  /** >400 km trip → also recommend a co-driver. */
  needsSecondary: boolean;
  /** Excluded from the "free" pool; offered only as the reclaim fallback. */
  dutyDriverId: string | null;
  drivers: RecoDriver[];
}

interface Hit {
  driverId: string;
  vehicleId: string;
  driverName: string | null;
  registrationNumber: string | null;
  /** Recommended co-driver (>400 km). null when not needed or none free. */
  secondaryDriverId: string | null;
  secondaryDriverName: string | null;
}

export type Placement =
  | ({ kind: "fit" } & Hit)
  | ({ kind: "reclaim" } & Hit)
  | { kind: "none" };

const overlaps = (a: { startAt: Date; endAt: Date }, b: { startAt: Date; endAt: Date }) =>
  a.startAt < b.endAt && b.startAt < a.endAt;

export function recommendPlacement(input: RecoInput): Placement {
  const { booking, needsSecondary, dutyDriverId, drivers } = input;

  const free = drivers
    .filter((d) => d.driverId !== dutyDriverId)
    .filter((d) => d.vehicleId)
    .filter((d) => !d.trips.some((t) => overlaps(t, booking)))
    .sort(
      (a, b) =>
        a.earningsScore - b.earningsScore ||
        (a.lastAssignedAt?.getTime() ?? -Infinity) - (b.lastAssignedAt?.getTime() ?? -Infinity) ||
        a.driverId.localeCompare(b.driverId),
    );

  let primary: RecoDriver | undefined = free[0];
  let kind: "fit" | "reclaim" = "fit";
  if (!primary) {
    // Nobody free → the duty car is the only one that may overlap (reclaim).
    primary = drivers.find((d) => d.driverId === dutyDriverId && d.vehicleId);
    kind = "reclaim";
  }
  if (!primary) return { kind: "none" };

  // Co-driver = next-fairest free non-duty driver (rides in the primary's car).
  let secondaryDriverId: string | null = null;
  let secondaryDriverName: string | null = null;
  if (needsSecondary) {
    const sec = free.find((d) => d.driverId !== primary!.driverId);
    if (sec) {
      secondaryDriverId = sec.driverId;
      secondaryDriverName = sec.driverName;
    }
  }

  return {
    kind,
    driverId: primary.driverId,
    vehicleId: primary.vehicleId!,
    driverName: primary.driverName,
    registrationNumber: primary.registrationNumber,
    secondaryDriverId,
    secondaryDriverName,
  };
}
