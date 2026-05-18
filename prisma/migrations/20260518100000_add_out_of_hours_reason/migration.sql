-- Allow requesters to record a justification when the trip falls outside
-- driver work hours (07:00–18:00) or spans midnight.

ALTER TABLE "Booking" ADD COLUMN "outOfHoursReason" TEXT;
