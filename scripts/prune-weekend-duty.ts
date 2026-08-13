/**
 * Remove auto-rostered เวร shifts that fell on a Saturday or Sunday.
 *
 * The auto-rotation had no notion of a week and filled all seven days, so every
 * calendar showed a weekend เวร badge and the named driver was "reserved all
 * day" — excluded from every other pick — for a duty the faculty does not run.
 * `duty-roster.ts` no longer creates them; this clears the ones already written.
 *
 * FUTURE days only. `ensureOnCallRosterThrough` never backfills ("history is
 * whatever it was"), so a past weekend shift is a record of what happened and is
 * left alone.
 *
 * Refuses to touch a day that has a WERN booking on it: that would be a weekend
 * duty somebody actually served, whatever wrote the row.
 *
 *   npx tsx scripts/prune-weekend-duty.ts          # report only
 *   npx tsx scripts/prune-weekend-duty.ts --apply  # delete
 */
import { prisma } from "../lib/db";
import { localDayOfDbDate } from "../lib/booking/db-date";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// localDayOfDbDate, never the raw value: writing local midnight of D into an
// @db.Date column stores D-1, so a Monday shift reads back as the Sunday. Asking
// getDay() of the stored value calls every Monday duty a weekend one.
const localOf = (stored: Date) => localDayOfDbDate(stored);
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isWeekend = (stored: Date) => [0, 6].includes(localOf(stored).getDay());

async function main() {
  const apply = process.argv.includes("--apply");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const future = await prisma.onCallShift.findMany({
    where: { date: { gte: today } },
    orderBy: { date: "asc" },
    select: { id: true, date: true, driverId: true },
  });
  const weekend = future.filter((s) => isWeekend(s.date));

  // A WERN booking on that day means the weekend duty was real. Compare on the
  // same key the roster writes: `date` is @db.Date, so re-deriving a day from the
  // value Prisma returns shifts it.
  const wern = await prisma.booking.findMany({
    where: { jobType: "WERN", status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] } },
    select: { startAt: true },
  });
  // startAt is a real timestamp, so its local day needs no un-shifting.
  const wernDays = new Set(wern.map((b) => keyOf(b.startAt)));

  const keep = weekend.filter((s) => wernDays.has(keyOf(localOf(s.date))));
  const drop = weekend.filter((s) => !wernDays.has(keyOf(localOf(s.date))));

  console.log(`future เวร shifts:      ${future.length}`);
  console.log(`on a weekend:          ${weekend.length}`);
  console.log(`kept (has WERN work):  ${keep.length}`);
  console.log(`to remove:             ${drop.length}`);
  for (const s of drop) {
    const loc = localOf(s.date);
    console.log(`  ${keyOf(loc)} ${DOW[loc.getDay()]}  driver ${s.driverId.slice(-6)}`);
  }
  for (const s of keep) {
    console.log(`  KEEP ${keyOf(localOf(s.date))} — a WERN booking sits on this day`);
  }

  if (!apply) {
    console.log("\nreport only — pass --apply to delete");
    return;
  }
  if (drop.length === 0) {
    console.log("\nnothing to do");
    return;
  }
  const res = await prisma.onCallShift.deleteMany({ where: { id: { in: drop.map((s) => s.id) } } });
  console.log(`\ndeleted ${res.count}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
