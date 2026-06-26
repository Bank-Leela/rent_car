-- Coordinator contact, trip direction, and remark for the booking form
-- (mirrors the official paper request form). Additive + idempotent so it
-- applies cleanly over a dev DB that has drifted.

DO $$ BEGIN
  CREATE TYPE "TripType" AS ENUM ('ROUND_TRIP', 'DROP_OFF', 'PICK_UP_DROP_OFF');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "coordinatorName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "coordinatorPhone" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "tripType" "TripType",
  ADD COLUMN IF NOT EXISTS "remark" TEXT;
