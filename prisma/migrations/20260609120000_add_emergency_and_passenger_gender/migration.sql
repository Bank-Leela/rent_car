-- Emergency flag + reason, and optional male/female passenger breakdown on Booking.
ALTER TABLE "Booking" ADD COLUMN "maleCount" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "femaleCount" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "isEmergency" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Booking" ADD COLUMN "emergencyReason" TEXT;
