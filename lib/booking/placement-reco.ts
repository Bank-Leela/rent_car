// Placement recommendation for a leftover (overflowed / unassigned) booking —
// the suggestion P'Top sees when the auto-solver couldn't place a trip. Pure;
// no I/O. The fairness order matches the solver/matcher (earnings ↑, then
// lastAssignedAt ↑). The 2-job/day cap is intentionally NOT applied: this is a
// manual override, so any non-duty car whose driver is free at the trip's time
// (no overlapping trip) is fair game. If none is free, fall back to the duty
// car — the only car allowed to overlap.

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
  /** Excluded from the "free" pool; offered only as the reclaim fallback. */
  dutyDriverId: string | null;
  drivers: RecoDriver[];
}

export type Placement =
  | { kind: "fit"; driverId: string; vehicleId: string; driverName: string | null; registrationNumber: string | null }
  | { kind: "reclaim"; driverId: string; vehicleId: string; driverName: string | null; registrationNumber: string | null }
  | { kind: "none" };

const overlaps = (a: { startAt: Date; endAt: Date }, b: { startAt: Date; endAt: Date }) =>
  a.startAt < b.endAt && b.startAt < a.endAt;

const place = (d: RecoDriver, kind: "fit" | "reclaim"): Placement => ({
  kind,
  driverId: d.driverId,
  vehicleId: d.vehicleId!,
  driverName: d.driverName,
  registrationNumber: d.registrationNumber,
});

export function recommendPlacement(input: RecoInput): Placement {
  const { booking, dutyDriverId, drivers } = input;

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
  if (free[0]) return place(free[0], "fit");

  // Nobody free → the duty car is the only one that may overlap (reclaim).
  const duty = drivers.find((d) => d.driverId === dutyDriverId && d.vehicleId);
  if (duty) return place(duty, "reclaim");

  return { kind: "none" };
}
