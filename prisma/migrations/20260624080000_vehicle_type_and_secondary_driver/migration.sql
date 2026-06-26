-- CreateEnum
CREATE TYPE "PreferredVehicleType" AS ENUM ('VAN', 'TRUCK_6_WHEEL', 'PICKUP', 'SEDAN_DEAN', 'BUS_OUTSOURCED');

-- Booking: replace the soft vehicle-id reference (never surfaced anywhere)
-- with a required vehicle-category choice. Also drop estimatedDistance's
-- only remaining producer (the requester form no longer collects it).
ALTER TABLE "Booking" DROP COLUMN "preferredVehicleId";
ALTER TABLE "Booking" ADD COLUMN "preferredVehicleType" "PreferredVehicleType" NOT NULL DEFAULT 'VAN';

-- Admin-set flag replacing the old estimatedDistance > 400km auto-check for
-- whether a trip needs a secondary driver.
ALTER TABLE "Booking" ADD COLUMN "needsSecondaryDriver" BOOLEAN NOT NULL DEFAULT false;

-- TripTemplate: mirror the same vehicle-category field; drop its now-unused
-- estimatedDistance snapshot.
ALTER TABLE "TripTemplate" DROP COLUMN "estimatedDistance";
ALTER TABLE "TripTemplate" DROP COLUMN "preferredVehicleId";
ALTER TABLE "TripTemplate" ADD COLUMN "preferredVehicleType" "PreferredVehicleType" NOT NULL DEFAULT 'VAN';
