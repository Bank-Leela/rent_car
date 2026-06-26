-- Booking: whether the vehicle waits at the destination, and (independently)
-- what time it returns to collect passengers if it doesn't.
ALTER TABLE "Booking" ADD COLUMN "waitAtDestination" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Booking" ADD COLUMN "pickupReturnTime" TEXT;

-- TripTemplate: mirror the same fields.
ALTER TABLE "TripTemplate" ADD COLUMN "waitAtDestination" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TripTemplate" ADD COLUMN "pickupReturnTime" TEXT;
