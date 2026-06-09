-- "Trip leaves the university (outside Chula)" flag, replacing the province dropdown.
ALTER TABLE "Booking" ADD COLUMN "outsideChula" BOOLEAN NOT NULL DEFAULT false;
