-- Driver "off for the day" (sick / leave). The day's pool loaders exclude these
-- drivers; fairness + rotation self-heal on return. Additive + idempotent.

CREATE TABLE IF NOT EXISTS "DriverUnavailability" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverUnavailability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DriverUnavailability_driverId_date_key"
    ON "DriverUnavailability" ("driverId", "date");

CREATE INDEX IF NOT EXISTS "DriverUnavailability_date_idx"
    ON "DriverUnavailability" ("date");

DO $$ BEGIN
  ALTER TABLE "DriverUnavailability"
    ADD CONSTRAINT "DriverUnavailability_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
