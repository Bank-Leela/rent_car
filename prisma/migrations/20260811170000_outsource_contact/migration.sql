-- Contact for an outside (hired) vehicle: who the passengers actually ring.
--
-- Two places, on purpose. The AdHocVehicle row is where the admin types it once
-- per hired vehicle for the day; the Booking columns are what the requester's
-- page reads. A trip can become OUTSOURCED two ways — attached to a board row,
-- or through the manual vendor form on its own detail page — and only the
-- booking-side columns are present on both paths.
--
-- All four are nullable with no default: every existing row keeps working and
-- simply has no contact recorded, which is the truth about it.

ALTER TABLE "AdHocVehicle" ADD COLUMN "contactName" TEXT;
ALTER TABLE "AdHocVehicle" ADD COLUMN "contactPhone" TEXT;

ALTER TABLE "Booking" ADD COLUMN "outsourceContactName" TEXT;
ALTER TABLE "Booking" ADD COLUMN "outsourceContactPhone" TEXT;
