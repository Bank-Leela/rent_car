-- No-wait split: end of leg 1 (driver free after drop-off). Null ⇒ single interval.
ALTER TABLE "Booking" ADD COLUMN "dropOffDone" TIMESTAMP(3);
ALTER TABLE "TripTemplate" ADD COLUMN "dropOffDone" TIMESTAMP(3);
