-- CR-06: align JobType taxonomy with supervisor's matrix.
-- Drop SMUS (was an invented placeholder), add ON_CALL + GENERAL.
-- Backfill any existing SMUS rows to GENERAL (closest equivalent).

CREATE TYPE "JobType_new" AS ENUM ('OUT_OF_PROVINCE', 'OT', 'ON_CALL', 'GENERAL');

ALTER TABLE "Booking"
  ALTER COLUMN "jobType" TYPE "JobType_new"
  USING (
    CASE "jobType"::text
      WHEN 'SMUS' THEN 'GENERAL'
      ELSE "jobType"::text
    END
  )::"JobType_new";

DROP TYPE "JobType";
ALTER TYPE "JobType_new" RENAME TO "JobType";

-- Escalation flag: matcher couldn't auto-place, ops handed to Khun Top.
ALTER TABLE "Booking" ADD COLUMN "escalatedToKhunTop" BOOLEAN NOT NULL DEFAULT false;
