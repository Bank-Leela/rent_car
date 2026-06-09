-- Pickup location + requester's preferred vehicle (soft reference) on Booking.
ALTER TABLE "Booking" ADD COLUMN "pickupLocation" TEXT;
ALTER TABLE "Booking" ADD COLUMN "preferredVehicleId" TEXT;
