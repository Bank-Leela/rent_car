import { Prisma, type BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

// Single source of truth for an audit-log transition write. Every booking
// status change (approve, deny, match, batch, claim, complete, cancel,
// outsource, reclaim…) goes through here so the audit-row contract lives in one
// place. Pass `tx` to enrol the write in an open transaction; omit it to use the
// shared client — that tx-vs-prisma choice used to be re-decided at every call
// site, which is exactly what this centralizes.
export async function logTransition(args: {
  bookingId: string;
  actorUserId: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus | null;
  action: string;
  metadata?: Prisma.InputJsonValue;
  tx?: Prisma.TransactionClient;
}) {
  const client = args.tx ?? prisma;
  await client.auditLog.create({
    data: {
      bookingId: args.bookingId,
      actorUserId: args.actorUserId,
      fromStatus: args.fromStatus,
      toStatus: args.toStatus,
      action: args.action,
      metadata: args.metadata,
    },
  });
}
