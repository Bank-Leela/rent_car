-- Booking: where the vehicle parks/waits near the destination while waiting
-- (distinct from `destination` itself, e.g. a specific parking spot).
ALTER TABLE "Booking" ADD COLUMN "waitingLocation" TEXT;

-- TripTemplate: mirror the same field.
ALTER TABLE "TripTemplate" ADD COLUMN "waitingLocation" TEXT;
