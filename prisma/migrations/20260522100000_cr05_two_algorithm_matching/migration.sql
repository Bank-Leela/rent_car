-- CR-05: two-algorithm matching architecture.
-- Replaces CR-03 JobTier-based auto-assign with explicit JobType + TimeBucket
-- categories, a duty-vehicle flag, and a per-driver last-assigned tie-break.

-- 1. New enums.
CREATE TYPE "JobType" AS ENUM ('OUT_OF_PROVINCE', 'OT', 'SMUS');
CREATE TYPE "TimeBucket" AS ENUM ('BEFORE_08', 'MORNING_08_12', 'AFTERNOON_12_16', 'AFTER_16');

-- 2. Vehicle.isReserved -> Vehicle.isDutyVehicle (rename, keep data).
ALTER TABLE "Vehicle" RENAME COLUMN "isReserved" TO "isDutyVehicle";

-- 3. Driver.lastAssignedAt (nullable; populated by the matcher going forward).
ALTER TABLE "Driver" ADD COLUMN "lastAssignedAt" TIMESTAMP(3);

-- 4. Booking.jobType + Booking.timeBucket. Add nullable, backfill, then NOT NULL.
ALTER TABLE "Booking" ADD COLUMN "jobType" "JobType";
ALTER TABLE "Booking" ADD COLUMN "timeBucket" "TimeBucket";

UPDATE "Booking" SET "jobType" = 'OT' WHERE "jobType" IS NULL;

UPDATE "Booking"
SET "timeBucket" = CASE
  WHEN EXTRACT(HOUR FROM "startAt") < 8 THEN 'BEFORE_08'::"TimeBucket"
  WHEN EXTRACT(HOUR FROM "startAt") < 12 THEN 'MORNING_08_12'::"TimeBucket"
  WHEN EXTRACT(HOUR FROM "startAt") < 16 THEN 'AFTERNOON_12_16'::"TimeBucket"
  ELSE 'AFTER_16'::"TimeBucket"
END
WHERE "timeBucket" IS NULL;

ALTER TABLE "Booking" ALTER COLUMN "jobType" SET NOT NULL;
ALTER TABLE "Booking" ALTER COLUMN "timeBucket" SET NOT NULL;

-- 5. Drop the CR-03 JobTier field + enum.
ALTER TABLE "Booking" DROP COLUMN "jobTier";
DROP TYPE "JobTier";
