-- A driver who goes off sick while holding a trip the system must not silently
-- re-dispatch (one already departed, or a multi-day ตจว that started earlier).
-- PG 16 allows ADD VALUE inside a transaction as long as the value is not USED
-- in the same one; nothing below references it.
ALTER TYPE "OverflowReason" ADD VALUE 'DRIVER_OFF_NEEDS_REVIEW';

-- Widen the audit log past bookings. Marking leave, swapping a เวร day by hand
-- and re-pairing a car to a driver previously left no trace at all — only their
-- consequences were logged — so "who marked this driver off, and when" had no
-- answer. Those rows carry entityType/entityId instead of a bookingId.
ALTER TABLE "AuditLog"
  ADD COLUMN "entityType" TEXT,
  ADD COLUMN "entityId" TEXT,
  ALTER COLUMN "bookingId" DROP NOT NULL;

CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx"
  ON "AuditLog"("entityType", "entityId", "createdAt");
