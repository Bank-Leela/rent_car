-- Merge reconciliation ("keep both"): the supervisor's travel_within_chula
-- migration RENAMED outsideChula -> travelWithinChula. Per the integration
-- decision both signals coexist, so re-add outsideChula as a separate
-- campus/off-campus hint (sub-project A chip; does not drive classification).
ALTER TABLE "Booking" ADD COLUMN "outsideChula" BOOLEAN NOT NULL DEFAULT false;
