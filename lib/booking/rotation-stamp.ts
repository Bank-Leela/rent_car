import type { JobType } from "@prisma/client";
import { prisma } from "@/lib/db";

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
