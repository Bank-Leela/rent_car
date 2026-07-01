-- CreateTable
CREATE TABLE "VehicleOccupancy" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VehicleOccupancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleOccupancy_vehicleId_idx" ON "VehicleOccupancy"("vehicleId");
CREATE INDEX "VehicleOccupancy_bookingId_idx" ON "VehicleOccupancy"("bookingId");

-- AddForeignKey
ALTER TABLE "VehicleOccupancy" ADD CONSTRAINT "VehicleOccupancy_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleOccupancy" ADD CONSTRAINT "VehicleOccupancy_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- No-double-book backstop (raw SQL — Prisma only owns the table above).
-- A GiST EXCLUDE on per-leg occupancy intervals makes it impossible for a car to
-- hold two overlapping intervals. A trigger derives those intervals from Booking,
-- mirroring lib/booking/trip-legs.ts.
--   * Columns are `timestamp(3)` (no tz) storing UTC instants → range type tsrange.
--   * A no-wait trip's leg-2 start comes from `pickupReturnTime` ("HH:mm"), which
--     trip-legs.ts resolves via Date.setHours = the app's LOCAL wall-clock. This
--     app runs in Asia/Bangkok, so booking_leg2_start() resolves HH:mm on the
--     Bangkok calendar day of startAt and converts back to the stored UTC value.
--     (trip-legs.ts + this fn both assume the app timezone is Asia/Bangkok.)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Bangkok-local "HH:mm" on the Bangkok calendar day of `start_utc`, as the stored
-- UTC timestamp. Mirrors trip-legs.ts onDay().
CREATE OR REPLACE FUNCTION booking_leg2_start(start_utc timestamp, hhmm text) RETURNS timestamp
LANGUAGE sql STABLE AS $$
  SELECT ((((start_utc AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date + hhmm::interval)
          AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC';
$$;

CREATE OR REPLACE FUNCTION sync_vehicle_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "VehicleOccupancy" WHERE "bookingId" = COALESCE(NEW.id, OLD.id);
  IF TG_OP <> 'DELETE'
     AND NEW."vehicleId" IS NOT NULL
     AND NEW.status IN ('APPROVED','ASSIGNED','COMPLETED') THEN
    IF NEW."waitAtDestination" = false
       AND NEW."dropOffDone" IS NOT NULL
       AND NEW."pickupReturnTime" IS NOT NULL THEN
      INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
        VALUES (gen_random_uuid()::text, NEW.id, NEW."vehicleId", NEW."startAt", NEW."dropOffDone");
      INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
        VALUES (gen_random_uuid()::text, NEW.id, NEW."vehicleId",
                booking_leg2_start(NEW."startAt", NEW."pickupReturnTime"), NEW."endAt");
    ELSE
      INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
        VALUES (gen_random_uuid()::text, NEW.id, NEW."vehicleId", NEW."startAt", NEW."endAt");
    END IF;
  END IF;
  RETURN NULL;
END; $$;

CREATE TRIGGER booking_occupancy_sync
  AFTER INSERT OR UPDATE OR DELETE ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION sync_vehicle_occupancy();

-- Backfill existing occupying bookings (the trigger only fires on future writes).
INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
SELECT gen_random_uuid()::text, id, "vehicleId", "startAt", "endAt"
FROM "Booking"
WHERE "vehicleId" IS NOT NULL AND status IN ('APPROVED','ASSIGNED','COMPLETED')
  AND NOT ("waitAtDestination" = false AND "dropOffDone" IS NOT NULL AND "pickupReturnTime" IS NOT NULL);

INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
SELECT gen_random_uuid()::text, id, "vehicleId", "startAt", "dropOffDone"
FROM "Booking"
WHERE "vehicleId" IS NOT NULL AND status IN ('APPROVED','ASSIGNED','COMPLETED')
  AND "waitAtDestination" = false AND "dropOffDone" IS NOT NULL AND "pickupReturnTime" IS NOT NULL;

INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt")
SELECT gen_random_uuid()::text, id, "vehicleId",
       booking_leg2_start("startAt", "pickupReturnTime"), "endAt"
FROM "Booking"
WHERE "vehicleId" IS NOT NULL AND status IN ('APPROVED','ASSIGNED','COMPLETED')
  AND "waitAtDestination" = false AND "dropOffDone" IS NOT NULL AND "pickupReturnTime" IS NOT NULL;

-- The backstop — added AFTER backfill so clean existing data doesn't reject it.
ALTER TABLE "VehicleOccupancy"
  ADD CONSTRAINT vehicle_occupancy_no_overlap
  EXCLUDE USING gist ("vehicleId" WITH =, tsrange("startAt","endAt",'[)') WITH &&);
