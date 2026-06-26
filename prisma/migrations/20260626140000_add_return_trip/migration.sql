-- One-way trips ("ไม่เดินทางกลับ"): the requester omits the return/end time and
-- an admin sets the real endAt at approval. Defaults to true (round trip) so
-- every existing booking/template keeps its current behaviour.
ALTER TABLE "Booking" ADD COLUMN "returnTrip" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TripTemplate" ADD COLUMN "returnTrip" BOOLEAN NOT NULL DEFAULT true;
