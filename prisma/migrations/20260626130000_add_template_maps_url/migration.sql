-- Carry the Google Maps link on a saved trip template so applying it restores
-- the destination's map link (the template now replaces the saved-places picker
-- in the booking form). Null for templates saved before this column existed.
ALTER TABLE "TripTemplate" ADD COLUMN "googleMapsUrl" TEXT;
