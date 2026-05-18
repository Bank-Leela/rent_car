-- CR-02: drivers self-organize. Add the claim table + per-booking schedule
-- lifecycle and enums.

CREATE TYPE "DriverScheduleStatus" AS ENUM ('UNCLAIMED', 'CLAIMED', 'CONFIRMED');
CREATE TYPE "ClaimRole" AS ENUM ('PRIMARY', 'SECONDARY');
CREATE TYPE "ClaimStatus" AS ENUM ('ACTIVE', 'RELEASED');

ALTER TABLE "Booking"
  ADD COLUMN "driverScheduleStatus" "DriverScheduleStatus" NOT NULL DEFAULT 'UNCLAIMED';

CREATE TABLE "BookingClaim" (
  "id"         TEXT NOT NULL,
  "bookingId"  TEXT NOT NULL,
  "driverId"   TEXT NOT NULL,
  "role"       "ClaimRole" NOT NULL,
  "status"     "ClaimStatus" NOT NULL DEFAULT 'ACTIVE',
  "claimedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BookingClaim_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BookingClaim"
  ADD CONSTRAINT "BookingClaim_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingClaim"
  ADD CONSTRAINT "BookingClaim_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "BookingClaim_bookingId_status_idx" ON "BookingClaim"("bookingId", "status");
CREATE INDEX "BookingClaim_driverId_status_idx" ON "BookingClaim"("driverId", "status");
