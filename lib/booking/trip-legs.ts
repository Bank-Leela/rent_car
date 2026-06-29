// Single source of truth for no-wait trip "legs". A trip that waits at the
// destination (or lacks split data) is one continuous interval; a no-wait trip
// with a drop-off-done time + a return time is two intervals, freeing the middle
// as real capacity. All overlap / 2h-gap math across the scheduler routes through
// here so the no-overlap invariant is defined in exactly one place.
// See docs/scheduling-algorithm.md §4–5.

export type Interval = { startAt: Date; endAt: Date };

export type LegSource = {
  startAt: Date;
  endAt: Date;
  waitAtDestination: boolean;
  dropOffDone: Date | null;
  pickupReturnTime: string | null; // "HH:mm", leg-2 start on the booking's day
};

// Resolve an "HH:mm" onto the calendar day of `ref`.
function onDay(ref: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(ref);
  d.setHours(h, m, 0, 0);
  return d;
}

// One interval when waiting or when split data is incomplete (back-compat); two
// intervals for a no-wait trip with both a drop-off-done time and a return time.
export function tripLegs(b: LegSource): Interval[] {
  if (b.waitAtDestination || !b.dropOffDone || !b.pickupReturnTime) {
    return [{ startAt: b.startAt, endAt: b.endAt }];
  }
  return [
    { startAt: b.startAt, endAt: b.dropOffDone },
    { startAt: onDay(b.startAt, b.pickupReturnTime), endAt: b.endAt },
  ];
}

// Half-open overlap: touching edges (a.end === b.start) do NOT overlap.
function intervalsOverlap(a: Interval, c: Interval): boolean {
  return a.startAt < c.endAt && c.startAt < a.endAt;
}

// True if ANY leg of a overlaps ANY leg of b.
export function legsOverlap(a: LegSource, b: LegSource): boolean {
  const la = tripLegs(a);
  const lb = tripLegs(b);
  return la.some((x) => lb.some((y) => intervalsOverlap(x, y)));
}

// Smallest gap (minutes) between any non-overlapping pair of legs; 0 if any
// pair overlaps. Used for the universal ≥2h-gap rule.
export function minLegGapMinutes(a: LegSource, b: LegSource): number {
  const la = tripLegs(a);
  const lb = tripLegs(b);
  let min = Infinity;
  for (const x of la) {
    for (const y of lb) {
      if (intervalsOverlap(x, y)) return 0;
      const gap =
        x.endAt <= y.startAt
          ? y.startAt.getTime() - x.endAt.getTime()
          : x.startAt.getTime() - y.endAt.getTime();
      min = Math.min(min, gap);
    }
  }
  return Math.round(min / 60000);
}
