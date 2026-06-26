// Pure helpers for routing WERN (campus duty) AROUND drivers who are away on a
// multi-day TJW. The batch solver enforces this via `awayOnTjw`; these mirror it
// for the single-booking matcher and the duty-roster auto-rotation, so the
// "never give WERN to an away driver" rule holds on EVERY assignment path
// (docs/scheduling-algorithm.md §1 + §6).

export type DutyCandidate = { driverId: string; lastDutyAt: Date | null };

// Oldest-`lastDutyAt`-first (null = never on duty = oldest), then driverId for
// determinism — the same order the solver's pickDutyRotation uses.
function byDutyRotation(a: DutyCandidate, b: DutyCandidate): number {
  return (
    (a.lastDutyAt?.getTime() ?? -Infinity) - (b.lastDutyAt?.getTime() ?? -Infinity) ||
    a.driverId.localeCompare(b.driverId)
  );
}

// Which driver a WERN booking routes to: the on-call driver when they're present
// (not away on a TJW) AND have a car; otherwise the duty rotation falls back to
// the fairest present, car-paired driver. null → no one can take it (→ overflow).
export function resolveWernDriver(input: {
  onCallDriverId: string | null;
  awayDriverIds: Set<string>;
  hasCar: (driverId: string) => boolean;
  candidates: DutyCandidate[];
}): string | null {
  const { onCallDriverId, awayDriverIds, hasCar, candidates } = input;
  if (onCallDriverId && !awayDriverIds.has(onCallDriverId) && hasCar(onCallDriverId)) {
    return onCallDriverId;
  }
  const fallback = candidates
    .filter((c) => !awayDriverIds.has(c.driverId) && hasCar(c.driverId))
    .sort(byDutyRotation);
  return fallback[0]?.driverId ?? null;
}

export type RotationCandidate = { driverId: string; lastOnCallAt: Date | null };

// Which driver the daily duty roster auto-rotates to: the most-overdue (oldest
// last on-call) driver who is NOT away on a TJW spanning the duty day. If every
// candidate is away, fall back to the full pool so a duty is still named.
export function pickAutoDutyDriver(
  candidates: RotationCandidate[],
  awayDriverIds: Set<string>,
): string | null {
  const byRotation = (a: RotationCandidate, b: RotationCandidate) =>
    (a.lastOnCallAt?.getTime() ?? -Infinity) - (b.lastOnCallAt?.getTime() ?? -Infinity) ||
    a.driverId.localeCompare(b.driverId);
  const present = candidates.filter((c) => !awayDriverIds.has(c.driverId));
  const pool = present.length ? present : candidates;
  return [...pool].sort(byRotation)[0]?.driverId ?? null;
}
