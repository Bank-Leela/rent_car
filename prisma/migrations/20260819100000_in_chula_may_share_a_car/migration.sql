-- ============================================================================
-- In-Chula trips may share a car (docs/scheduling-algorithm.md §5c)
--
-- §5 has always said no car may EVER be double-booked, and the GiST EXCLUDE
-- below was the thing that made it true rather than merely intended. The office
-- has asked for one deliberate exception: two campus errands starting within ten
-- minutes of each other are close enough that one car runs both, and P'Top's
-- judgement is better than a constraint at deciding when.
--
-- The exception is exactly that and no wider. The naive implementation — making
-- the existing constraint partial with `WHERE (NOT "inChula")` — is WRONG in a
-- way that is easy to miss: a partial index simply does not contain in-Chula
-- rows, so a campus errand could be stacked onto a car that is away on a 400 km
-- TJW. What is wanted is "conflict UNLESS BOTH rows are in-Chula", which no
-- single EXCLUDE can express, so it takes two:
--
--   c1  partial, non-Chula only   → two normal trips still conflict
--   c2  adds "inChula" WITH <>    → in-Chula vs normal still conflicts
--   (in-Chula vs in-Chula falls in neither → permitted)
--
-- The flag is cast to int in c2, and that cast is NOT cosmetic. btree_gist only
-- grew a bool operator class in version 1.7, which ships with PostgreSQL 16.
-- The faculty server runs PostgreSQL 14, whose newest btree_gist is 1.6, so
-- `"inChula" WITH <>` there fails at ALTER TABLE with
--   ERROR: data type boolean has no default operator class for access method "gist"
-- and takes the whole migration down with it (observed on the live database
-- 2026-08-21; it rolled back cleanly, but the deploy was blocked until this was
-- fixed). int4 has had a gist opclass since btree_gist 1.0, and bool::int is
-- 0/1, so <> on the cast is the same predicate on every server version.
--
-- Verified on the deployed PostgreSQL 14: both constraints create cleanly,
-- normal-vs-normal is refused by c1, Chula-vs-normal by c2, and Chula-vs-Chula
-- is accepted.
--
-- ACCEPTED RISK, recorded because the database can no longer catch it: there is
-- no ceiling. Five in-Chula bookings at 09:00 will all stack on the duty car and
-- only the app warns. That was the office's explicit choice — P'Top decides each
-- time — made after being shown that Postgres would stop refusing it.
-- ============================================================================

ALTER TABLE "VehicleOccupancy" ADD COLUMN "inChula" BOOLEAN NOT NULL DEFAULT false;

-- Backfill from the bookings the rows were derived from, so existing occupancy
-- is judged by the same rule as anything written from now on.
UPDATE "VehicleOccupancy" o
SET "inChula" = b."travelWithinChula"
FROM "Booking" b
WHERE b.id = o."bookingId";

-- The trigger learns to carry the flag. Same shape as before — the only change
-- is that every INSERT now also writes NEW."travelWithinChula".
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
      INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt","inChula")
        VALUES (gen_random_uuid()::text, NEW.id, NEW."vehicleId", NEW."startAt", NEW."dropOffDone",
                NEW."travelWithinChula");
      INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt","inChula")
        VALUES (gen_random_uuid()::text, NEW.id, NEW."vehicleId",
                booking_leg2_start(NEW."startAt", NEW."pickupReturnTime"), NEW."endAt",
                NEW."travelWithinChula");
    ELSE
      INSERT INTO "VehicleOccupancy" (id,"bookingId","vehicleId","startAt","endAt","inChula")
        VALUES (gen_random_uuid()::text, NEW.id, NEW."vehicleId", NEW."startAt", NEW."endAt",
                NEW."travelWithinChula");
    END IF;
  END IF;
  RETURN NULL;
END; $$;

-- Swap one constraint for two. Dropping first is safe in either order here, but
-- the weaker pair can never reject data that satisfied the stricter single one,
-- so nothing existing needs fixing before they go on.
ALTER TABLE "VehicleOccupancy" DROP CONSTRAINT vehicle_occupancy_no_overlap;

ALTER TABLE "VehicleOccupancy"
  ADD CONSTRAINT vehicle_occupancy_no_overlap
  EXCLUDE USING gist ("vehicleId" WITH =, tsrange("startAt","endAt",'[)') WITH &&)
  WHERE (NOT "inChula");

ALTER TABLE "VehicleOccupancy"
  ADD CONSTRAINT vehicle_occupancy_chula_vs_normal
  EXCLUDE USING gist ("vehicleId" WITH =, tsrange("startAt","endAt",'[)') WITH &&, (("inChula")::int) WITH <>);
