-- Hot-path indexes for Booking: the no-overlap check + board/calendar load
-- filter on a car or a driver over a time window; the committed/day queries
-- filter status + range. Additive only. IF NOT EXISTS keeps it idempotent.
CREATE INDEX IF NOT EXISTS "Booking_vehicleId_startAt_idx" ON "Booking"("vehicleId", "startAt");
CREATE INDEX IF NOT EXISTS "Booking_primaryDriverId_startAt_idx" ON "Booking"("primaryDriverId", "startAt");
CREATE INDEX IF NOT EXISTS "Booking_secondaryDriverId_startAt_idx" ON "Booking"("secondaryDriverId", "startAt");
CREATE INDEX IF NOT EXISTS "Booking_status_startAt_endAt_idx" ON "Booking"("status", "startAt", "endAt");
