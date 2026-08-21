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

/** What a non-booking audit row is about. */
export type AuditEntity = "DRIVER" | "ON_CALL" | "VEHICLE" | "USER";

/**
 * Log a change that is not about one booking.
 *
 * The audit log used to require a bookingId, so three decisions left no trace at
 * all: marking a driver off sick/on leave, swapping a เวร day by hand, and
 * re-pairing a car to a driver. Their *consequences* were logged (trips moved,
 * trips released) but not the decision, so "who marked ก off on Tuesday" had no
 * answer. Same table, same actor/action/metadata contract — the subject moves
 * from bookingId to entityType/entityId.
 */
export async function logEvent(args: {
  actorUserId: string;
  entityType: AuditEntity;
  entityId: string;
  action: string;
  metadata?: Prisma.InputJsonValue;
  tx?: Prisma.TransactionClient;
}) {
  const client = args.tx ?? prisma;
  await client.auditLog.create({
    data: {
      bookingId: null,
      entityType: args.entityType,
      entityId: args.entityId,
      actorUserId: args.actorUserId,
      action: args.action,
      metadata: args.metadata,
    },
  });
}
