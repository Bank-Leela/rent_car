// Shared fairness ledger loader. Duration-weighted earnings per driver over the
// fairness window — the single source the batch solver, single-booking matcher,
// and overtime recommendation all rank by.

import { subDays } from "date-fns";
import { prisma } from "@/lib/db";
import { tripEffort } from "@/lib/booking/classification";

export const FAIRNESS_WINDOW_DAYS = 30;

export async function loadWeightedEarnings(driverIds: string[]): Promise<Map<string, number>> {
  if (driverIds.length === 0) return new Map();
  const since = subDays(new Date(), FAIRNESS_WINDOW_DAYS);
  const rows = await prisma.booking.findMany({
    where: {
      startAt: { gte: since },
      status: { in: ["ASSIGNED", "COMPLETED"] },
      OR: [{ primaryDriverId: { in: driverIds } }, { secondaryDriverId: { in: driverIds } }],
    },
    select: { primaryDriverId: true, secondaryDriverId: true, jobType: true, startAt: true, endAt: true },
  });
  const scores = new Map<string, number>(driverIds.map((id) => [id, 0]));
  for (const b of rows) {
    const weight = tripEffort(b.jobType, b.startAt, b.endAt);
    if (b.primaryDriverId && scores.has(b.primaryDriverId)) {
      scores.set(b.primaryDriverId, scores.get(b.primaryDriverId)! + weight);
    }
    if (b.secondaryDriverId && scores.has(b.secondaryDriverId)) {
      scores.set(b.secondaryDriverId, scores.get(b.secondaryDriverId)! + weight);
    }
  }
  return scores;
}
