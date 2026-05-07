import type { Prisma } from "@prisma/client";

/**
 * Job number format: VB-YYYYMM-NNNN where NNNN is the per-month sequence (1-based).
 * Allocated atomically inside a transaction by counting existing bookings created
 * in the same calendar month and adding 1. Callers MUST run this inside a Prisma
 * transaction so the count + insert are serialized.
 */
export async function nextJobNumber(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string> {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const monthStart = new Date(Date.UTC(yyyy, now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(yyyy, now.getUTCMonth() + 1, 1));

  const countThisMonth = await tx.booking.count({
    where: { createdAt: { gte: monthStart, lt: monthEnd } },
  });

  const seq = String(countThisMonth + 1).padStart(4, "0");
  return `VB-${yyyy}${mm}-${seq}`;
}
