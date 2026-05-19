-- Auto-assign algorithm: job tier classification + daily on-call rotation.

CREATE TYPE "JobTier" AS ENUM ('INTERNATIONAL', 'SCHOOL', 'PROVINCIAL', 'ON_CALL');

ALTER TABLE "Booking" ADD COLUMN "jobTier" "JobTier";

CREATE TABLE "OnCallShift" (
  "id"        TEXT NOT NULL,
  "date"      DATE NOT NULL,
  "driverId"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnCallShift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnCallShift_date_key" ON "OnCallShift"("date");

ALTER TABLE "OnCallShift"
  ADD CONSTRAINT "OnCallShift_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
