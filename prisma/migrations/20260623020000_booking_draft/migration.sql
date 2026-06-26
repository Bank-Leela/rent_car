-- Driver "draft" schedule layer: proposed trades kept off P'Top's official
-- assignment until applied. Additive + idempotent.

CREATE TABLE IF NOT EXISTS "BookingDraft" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "proposedVehicleId" TEXT,
    "proposedSecondaryDriverId" TEXT,
    "submitted" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BookingDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BookingDraft_bookingId_key" ON "BookingDraft" ("bookingId");

DO $$ BEGIN
  ALTER TABLE "BookingDraft"
    ADD CONSTRAINT "BookingDraft_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
