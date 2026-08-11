/**
 * Group bookings into recurring series.
 *
 * A recurring booking is stored as one row per occurrence, with every child
 * pointing at the first one. The parent IS an occurrence, so the series key is
 * `recurrenceParentId ?? id` — that makes a non-recurring booking a series of
 * one, which callers can treat uniformly.
 *
 * Pure so the queue's paging can be reasoned about: a page limit counts CARDS,
 * and a card is a series, so grouping has to happen before slicing. Doing it the
 * other way round let a single five-week booking consume an entire page.
 */
export type SeriesGroup<T> = { key: string; items: T[] };

export function groupBySeries<
  T extends { id: string; recurrenceParentId: string | null; startAt: Date },
>(rows: readonly T[]): SeriesGroup<T>[] {
  const byKey = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row.recurrenceParentId ?? row.id;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key); // keep the caller's ordering of first appearance
    }
    byKey.get(key)!.push(row);
  }
  return order.map((key) => ({
    key,
    // Occurrences read as a sequence, so they are always shown in date order
    // even when the query was sorted by submission time.
    items: [...byKey.get(key)!].sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
  }));
}
