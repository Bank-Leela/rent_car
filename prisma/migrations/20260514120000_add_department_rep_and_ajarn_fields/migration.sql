-- Change request 01: department representative + ajarn contact fields.

-- Add representativeUserId to Department (unique, optional FK to User).
ALTER TABLE "Department" ADD COLUMN "representativeUserId" TEXT;

CREATE UNIQUE INDEX "Department_representativeUserId_key" ON "Department"("representativeUserId");

ALTER TABLE "Department"
  ADD CONSTRAINT "Department_representativeUserId_fkey"
  FOREIGN KEY ("representativeUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Add ajarn contact fields to Booking. Existing rows backfill with empty
-- strings; new submissions must provide non-empty values (enforced in app).
ALTER TABLE "Booking" ADD COLUMN "ajarnName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Booking" ADD COLUMN "ajarnPhone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Booking" ADD COLUMN "ajarnEmail" TEXT NOT NULL DEFAULT '';
