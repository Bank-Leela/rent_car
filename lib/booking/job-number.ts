import type { Prisma } from "@prisma/client";

/**
 * Job number format: VB-YYYYMM-NNNN where NNNN is the per-month sequence (1-based).
 * Caller MUST run inside a Prisma transaction. We take a Postgres advisory lock
 * keyed by YYYYMM so concurrent transactions in the same month serialize on the
 * count → insert critical section. Lock auto-releases on commit/rollback.
 */
export async function nextJobNumber(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string> {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const monthStart = new Date(Date.UTC(yyyy, now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(yyyy, now.getUTCMonth() + 1, 1));

  const bucket = Number(`${yyyy}${mm}`);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${bucket})`;

  const countThisMonth = await tx.booking.count({
    where: { createdAt: { gte: monthStart, lt: monthEnd } },
  });

  const seq = String(countThisMonth + 1).padStart(4, "0");
  return `VB-${yyyy}${mm}-${seq}`;
}
