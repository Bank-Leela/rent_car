-- Invert outsideChula -> travelWithinChula. Rename preserves the column,
-- then flip every existing value since the semantics are the exact opposite
-- (outsideChula=true meant "leaves campus"; travelWithinChula=true means
-- "stays on campus" — the new in-campus/WERN signal).
ALTER TABLE "Booking" RENAME COLUMN "outsideChula" TO "travelWithinChula";
UPDATE "Booking" SET "travelWithinChula" = NOT "travelWithinChula";

ALTER TABLE "TripTemplate" RENAME COLUMN "outsideChula" TO "travelWithinChula";
UPDATE "TripTemplate" SET "travelWithinChula" = NOT "travelWithinChula";
