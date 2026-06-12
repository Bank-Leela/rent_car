-- Coordinator contact captured on the booking form (separate from requester).
ALTER TABLE "Booking" ADD COLUMN     "coordinatorName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "coordinatorPhone" TEXT NOT NULL DEFAULT '';
