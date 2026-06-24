-- Per-day external/outside-driver board rows + the Booking link. Additive.

CREATE TABLE IF NOT EXISTS "AdHocVehicle" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "cost" DECIMAL(10,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdHocVehicle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdHocVehicle_date_idx" ON "AdHocVehicle" ("date");

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "adHocVehicleId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_adHocVehicleId_fkey"
    FOREIGN KEY ("adHocVehicleId") REFERENCES "AdHocVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
