import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { COMMITTED_STATUSES } from "@/lib/booking/booking-status";
import { pickAutoDutyDriver } from "@/lib/booking/duty-assignment";

// The เวร roster extends itself: whatever day you look at is already decided.
//
// Opening a date past the end of the roster tops it up to that day, so the
// rotation is continuous and the board never shows an unmanned day. The shifts
// are stored rather than merely projected because the allocator reserves the
// duty driver from these rows — a projected เวร would be shown as on duty while
// still being handed other trips.
//
// Safe to call on every page render: it writes only the days that are missing,
// so a second viewer of the same day does nothing, and a unique-constraint race
// between two simultaneous viewers is swallowed (that day is rostered either
// way). A day, once decided, is never rewritten — including a manual override.
//
// `MAX_LOOKAHEAD_DAYS` bounds a single top-up so that navigating years into the
// future can't write an unbounded number of rows in one request. Beyond it the
// board simply shows no duty driver, which is honest for a date that far out.
const MAX_LOOKAHEAD_DAYS = 370;

export async function ensureOnCallRosterThrough(through: Date): Promise<number> {
  const target = startOfDay(through);
  const today = startOfDay(new Date());
  if (target < today) return 0; // history is whatever it was; never backfilled

  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + MAX_LOOKAHEAD_DAYS);
  if (target > horizon) return 0;

  // Nothing to do when the viewed day is already rostered — the common case, and
  // one indexed lookup. Ask with the same value the write uses: `date` is
  // @db.Date, so deriving a key from the value Prisma returns would shift a day.
  const existing = await prisma.onCallShift.findUnique({
    where: { date: target },
    select: { id: true },
  });
  if (existing) return 0;

  const drivers = await prisma.driver.findMany({
    where: { isActive: true, user: { is: { isActive: true } } },
    select: {
      id: true,
      onCallShifts: { orderBy: { date: "desc" }, take: 1, select: { date: true } },
      unavailabilities: { select: { date: true } },
    },
  });
  if (drivers.length === 0) return 0;

  const lastOnCall = new Map<string, Date | null>(
    drivers.map((d) => [d.id, d.onCallShifts[0]?.date ?? null]),
  );
  const offDays = new Map<string, Set<number>>(
    drivers.map((d) => [d.id, new Set(d.unavailabilities.map((u) => startOfDay(u.date).getTime()))]),
  );

  // Start the day after the roster currently ends, so the rotation continues
  // rather than restarting; if it is empty or stale, start from today.
  const latest = await prisma.onCallShift.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const from = new Date(Math.max(today.getTime(), latest ? startOfDay(latest.date).getTime() : today.getTime()));

  const tjwSpanning = await prisma.booking.findMany({
    where: {
      jobType: "TJW",
      status: { in: COMMITTED_STATUSES },
      startAt: { lt: new Date(target.getTime() + 86_400_000) },
      endAt: { gt: from },
    },
    select: { primaryDriverId: true, secondaryDriverId: true, startAt: true, endAt: true },
  });

  let filled = 0;
  for (let day = new Date(from); day <= target; day.setDate(day.getDate() + 1)) {
    const current = new Date(day);
    const alreadySet = await prisma.onCallShift.findUnique({
      where: { date: current },
      select: { driverId: true },
    });
    if (alreadySet) {
      lastOnCall.set(alreadySet.driverId, current);
      continue;
    }

    const dayEnd = new Date(current);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const away = new Set<string>();
    for (const t of tjwSpanning) {
      if (t.startAt < dayEnd && t.endAt > current) {
        if (t.primaryDriverId) away.add(t.primaryDriverId);
        if (t.secondaryDriverId) away.add(t.secondaryDriverId);
      }
    }
    for (const d of drivers) if (offDays.get(d.id)?.has(current.getTime())) away.add(d.id);

    const chosen = pickAutoDutyDriver(
      drivers.map((d) => ({ driverId: d.id, lastOnCallAt: lastOnCall.get(d.id) ?? null })),
      away,
    );
    if (!chosen) continue;
    try {
      await prisma.onCallShift.create({ data: { date: current, driverId: chosen } });
      filled++;
    } catch {
      // Another request rostered this day first — fine, it is decided either way.
    }
    lastOnCall.set(chosen, current);
  }
  return filled;
}
