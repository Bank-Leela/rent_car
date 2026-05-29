-- CR-07: daily batch driver-assignment algorithm.
-- See docs/algorithm_change_log.md for the 10 design updates that led here.

-- 1. Rename JobType values to match supervisor's matrix exactly.
--    OUT_OF_PROVINCE → TJW (and split: overnight stays vs same-day OT)
--    ON_CALL        → WERN
--    GENERAL        → NORMAL
--    (SMUS added back as reachable but never auto-emitted by the classifier.)
CREATE TYPE "JobType_new" AS ENUM ('TJW', 'OT', 'WERN', 'NORMAL', 'SMUS');

ALTER TABLE "Booking"
  ALTER COLUMN "jobType" TYPE "JobType_new"
  USING (
    CASE "jobType"::text
      WHEN 'OUT_OF_PROVINCE' THEN 'TJW'
      WHEN 'ON_CALL'         THEN 'WERN'
      WHEN 'GENERAL'         THEN 'NORMAL'
      ELSE "jobType"::text
    END
  )::"JobType_new";

DROP TYPE "JobType";
ALTER TYPE "JobType_new" RENAME TO "JobType";

-- 2. OverflowReason for batch-level escalation.
CREATE TYPE "OverflowReason" AS ENUM (
  'NO_SLOT',
  'NO_PRIMARY_DRIVER',
  'NO_SECONDARY_DRIVER',
  'NEEDS_WERN_RECLAIM_DECISION'
);

-- 3. Booking: explicit out-of-province flag + overflow reason.
ALTER TABLE "Booking" ADD COLUMN "outOfProvince" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Booking" ADD COLUMN "overflowReason" "OverflowReason";

-- Backfill outOfProvince from province for existing rows. Bangkok in Thai +
-- the literal English form are both treated as local.
UPDATE "Booking"
SET "outOfProvince" = true
WHERE "province" NOT IN ('กรุงเทพมหานคร', 'Bangkok');

-- 4. Driver: per-category rotation timestamps.
ALTER TABLE "Driver" ADD COLUMN "lastTjwAt"  TIMESTAMP(3);
ALTER TABLE "Driver" ADD COLUMN "lastOtAt"   TIMESTAMP(3);
ALTER TABLE "Driver" ADD COLUMN "lastDutyAt" TIMESTAMP(3);

-- Seed lastDutyAt from existing OnCallShift history so the very first
-- batch run after the migration respects prior duty days.
UPDATE "Driver" d
SET "lastDutyAt" = sub.last_date
FROM (
  SELECT "driverId", MAX("date") AS last_date
  FROM "OnCallShift"
  GROUP BY "driverId"
) sub
WHERE d.id = sub."driverId";
