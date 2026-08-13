/**
 * Keys for `@db.Date` columns, so a read-back value and the day you are asking
 * about agree.
 *
 * Three columns are `@db.Date`: `OnCallShift.date` (the เวร roster),
 * `DriverUnavailability.date` (sick / leave) and `AdHocVehicle.date`.
 *
 * Every writer in this codebase hands in a LOCAL midnight — `leave-core`
 * applyLeaveDay, `duty-roster`, `matching-actions`, the demo seeds. Prisma stores
 * a `@db.Date` by truncating that instant to its **UTC** date part, so under the
 * pinned Asia/Bangkok (+07) offset the stored calendar date is the day BEFORE the
 * one intended, and the value read back is UTC midnight of that earlier date.
 *
 * Measured: writing local midnight of 2027-09-14 stores 2027-09-13 and reads back
 * as 2027-09-13T00:00:00Z.
 *
 * Querying is safe because the query value is truncated identically — the offset
 * is symmetric, so `where: { date: localMidnight }` matches. What is NOT safe is
 * deriving a key from the value Prisma returns and comparing it against a
 * locally-built day: `startOfDay(row.date)` and `format(row.date, "yyyy-MM-dd")`
 * both give the STORED date, which is 24 h from the day the row is about. That
 * mismatch silently made three leave/duty checks look at the wrong day — a driver
 * on leave could be rostered as เวร, handed a multi-day ตจว, or recommended for OT.
 *
 * `dbDateKey` is the fix and it works on BOTH sides without touching stored data,
 * because it applies the same truncation Prisma does:
 *
 *   dbDateKey(rowReadBack)    -> the stored date
 *   dbDateKey(localMidnight)  -> what would be stored for that local day
 *
 * so the two are equal exactly when the row is about that local day. It is also
 * offset-independent: nothing here assumes +07, only that writers are consistent.
 *
 * Fixing the stored values instead would mean a data migration over three tables;
 * that is worth doing on its own, and this keys correctly either way, since it
 * derives the key from the same instant the writer used.
 */
const pad = (n: number) => String(n).padStart(2, "0");

/** Stable key for a `@db.Date` day: the UTC calendar date of the given instant. */
export function dbDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Same key, per driver — for the leave lookups that are keyed by both. */
export function driverDayKey(driverId: string, d: Date): string {
  return `${driverId}|${dbDateKey(d)}`;
}

/**
 * The LOCAL day a `@db.Date` row is about, recovered from the value read back.
 *
 * Needed wherever the day is displayed or iterated rather than merely compared —
 * a leave list, a calendar tint, "the last rostered day". `startOfDay(row.date)`
 * is wrong for those: it yields the stored date, which is a day off.
 *
 * Derived by search, not by adding a fixed offset, so it holds east and west of
 * UTC and across a DST change: try the stored calendar date as a local day and
 * its two neighbours, and keep whichever one would be stored as this row.
 */
export function localDayOfDbDate(stored: Date): Date {
  const y = stored.getUTCFullYear();
  const m = stored.getUTCMonth();
  const d = stored.getUTCDate();
  const want = dbDateKey(stored);
  for (const shift of [0, 1, -1]) {
    const candidate = new Date(y, m, d + shift);
    if (dbDateKey(candidate) === want) return candidate;
  }
  // Unreachable for any real offset; return the naive reading rather than throw
  // in a display path.
  return new Date(y, m, d);
}
