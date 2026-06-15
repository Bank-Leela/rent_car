// One-off data fix: resolve ILLEGAL overlaps left by batch runs done before the
// "only the duty car may overlap" rule landed. A driver can't be in two places
// at once — neither driving their own car (primary) nor riding as a co-driver
// (secondary). So we treat BOTH roles as occupying the driver and keep, in
// priority order (TJW>OT>WERN>NORMAL, then earliest start), the largest
// non-overlapping set per driver; the rest are un-assigned back to the queue
// (APPROVED, no driver/car). Duty drivers (that day's OnCallShift) are exempt —
// their car is allowed to overlap.
//
// Re-place the queued trips afterwards with the normal batch/auto-match — the
// solver fix now prevents re-creating overlaps.
//
// Run:  npx tsx scripts/reconcile-overlaps.ts          (apply)
//       npx tsx scripts/reconcile-overlaps.ts --dry    (report only)

import { PrismaClient, type JobType } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

const PRIORITY: Record<JobType, number> = { TJW: 0, OT: 1, WERN: 2, NORMAL: 3, SMUS: 4 };
const ymdLocal = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const overlaps = (a: { startAt: Date; endAt: Date }, b: { startAt: Date; endAt: Date }) =>
  a.startAt < b.endAt && b.startAt < a.endAt;

async function main() {
  // Duty driver per local day.
  const shifts = await prisma.onCallShift.findMany({ select: { date: true, driverId: true } });
  const dutyByDay = new Map<string, string>();
  for (const s of shifts) dutyByDay.set(ymdLocal(s.date), s.driverId);

  // All assigned trips, with both roles. A driver is occupied by a trip whether
  // they're its primary (driving their car) or its secondary (co-driver).
  const trips = await prisma.booking.findMany({
    where: { status: "ASSIGNED", primaryDriverId: { not: null } },
    select: { id: true, jobNumber: true, jobType: true, startAt: true, endAt: true, primaryDriverId: true, secondaryDriverId: true },
  });

  // Global greedy: highest priority first, then earliest start. A trip is kept
  // only if NEITHER of its drivers is already busy then; otherwise it's queued.
  // A duty driver is exempt — never blocks and never gets blocked.
  const sorted = [...trips].sort(
    (a, b) => PRIORITY[a.jobType] - PRIORITY[b.jobType] || a.startAt.getTime() - b.startAt.getTime(),
  );
  const kept = new Map<string, { startAt: Date; endAt: Date }[]>(); // driverId → kept intervals
  const isDuty = (driverId: string, day: Date) => dutyByDay.get(ymdLocal(day)) === driverId;
  const busy = (driverId: string, t: { startAt: Date; endAt: Date }) =>
    (kept.get(driverId) ?? []).some((k) => overlaps(k, t));

  const toUnassign: typeof trips = [];
  for (const t of sorted) {
    const roleDrivers = [t.primaryDriverId, t.secondaryDriverId].filter(
      (d): d is string => !!d && !isDuty(d, t.startAt),
    );
    if (roleDrivers.some((d) => busy(d, t))) {
      toUnassign.push(t);
    } else {
      for (const d of roleDrivers) kept.set(d, [...(kept.get(d) ?? []), { startAt: t.startAt, endAt: t.endAt }]);
    }
  }

  if (toUnassign.length === 0) {
    console.log("No illegal non-duty overlaps found. Nothing to fix.");
    return;
  }

  console.log(`${DRY ? "[dry-run] would un-assign" : "Un-assigning"} ${toUnassign.length} overlapping trip(s) → queue:`);
  for (const t of toUnassign) {
    console.log(`  ${t.jobNumber}  ${t.jobType}  ${ymdLocal(t.startAt)} ${t.startAt.toTimeString().slice(0, 5)}-${t.endAt.toTimeString().slice(0, 5)}`);
  }

  if (!DRY) {
    // Per-row update: updateMany rejects relation FK scalars (primaryDriverId),
    // but update accepts them (same as reassignVehicleAction).
    for (const t of toUnassign) {
      await prisma.booking.update({
        where: { id: t.id },
        data: {
          status: "APPROVED",
          primaryDriverId: null,
          secondaryDriverId: null,
          vehicleId: null,
          driverScheduleStatus: "UNCLAIMED", // non-nullable enum — reset, not null
          decidedAt: null,
          overflowReason: null,
        },
      });
    }
    console.log(`\nDone. ${toUnassign.length} trip(s) returned to the queue. Re-run the batch / auto-match to re-place them.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
