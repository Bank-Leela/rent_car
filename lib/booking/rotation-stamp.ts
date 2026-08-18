import type { JobType } from "@prisma/client";
import { prisma } from "@/lib/db";

/** A prisma client or an interactive-transaction client — both have `driver`. */
type TxLike = Pick<typeof prisma, "driver">;

/**
 * Reset a driver's category-rotation stamp (lastTjwAt / lastOtAt / lastDutyAt)
 * to their most-recent remaining trip of that category — used when a booking is
 * cancelled or demo data is cleared, so a removed assignment doesn't leave a
 * stale stamp. Shared by batch-actions (cancellation rollback) and
 * batch-demo-actions (clear demo).
 */
export async function recomputeRotationStamp(driverId: string, jobType: JobType): Promise<void> {
  const field =
    jobType === "TJW" ? "lastTjwAt" :
    jobType === "OT" ? "lastOtAt" :
    jobType === "WERN" ? "lastDutyAt" : null;
  if (!field) return;
  // Find the most-recent prior trip of this category for the driver that
  // is still ASSIGNED or COMPLETED.
  const last = await prisma.booking.findFirst({
    where: {
      jobType,
      status: { in: ["ASSIGNED", "COMPLETED"] },
      OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
    },
    orderBy: { startAt: "desc" },
    select: { startAt: true },
  });
  await prisma.driver.update({
    where: { id: driverId },
    data: { [field]: last?.startAt ?? null } as Record<string, Date | null>,
  });
}

/**
 * Move a driver's rotation clocks FORWARD only.
 *
 * `lastAssignedAt` (and the per-category stamps) answer "who has been waiting
 * longest" — the whole fairness order is built on them. A plain
 * `update({ lastAssignedAt: stamp })` sets whatever it is given, so stamping a
 * trip dated in the PAST drags the clock backwards and the driver starts
 * looking like the least-recently-used one in the fleet. They then win the next
 * several rotations they should have lost.
 *
 * That was reachable the moment backdated bookings existed: approving one ran
 * the day solver on a past date, which assigned a driver and stamped them with
 * the trip's own startAt. Measured on a trip nine days old — one driver's
 * `lastAssignedAt` moved backwards.
 *
 * The guard is in the WHERE clause, not read-then-write, so two concurrent
 * assignments cannot both decide they are the newer one. A row that is already
 * ahead simply matches nothing and is left alone.
 */
export async function stampRotationForward(
  tx: TxLike,
  driverId: string,
  stamp: Date,
  jobType?: JobType,
): Promise<void> {
  const field =
    jobType === "TJW" ? "lastTjwAt" :
    jobType === "OT" ? "lastOtAt" :
    jobType === "WERN" ? "lastDutyAt" : null;

  await tx.driver.updateMany({
    where: {
      id: driverId,
      OR: [{ lastAssignedAt: null }, { lastAssignedAt: { lt: stamp } }],
    },
    data: { lastAssignedAt: stamp },
  });
  // The category clock advances on its own condition: a driver's last TJW and
  // last assignment of any kind are different questions and move apart.
  if (field) {
    await tx.driver.updateMany({
      where: { id: driverId, OR: [{ [field]: null }, { [field]: { lt: stamp } }] },
      data: { [field]: stamp } as Record<string, Date>,
    });
  }
}
