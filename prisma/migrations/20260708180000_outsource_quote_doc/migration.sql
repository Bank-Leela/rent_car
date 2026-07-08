-- Uploaded quote document (ใบเสนอราคา) for outsourced trips.
ALTER TABLE "Booking" ADD COLUMN "outsourceQuoteUrl" TEXT;
ALTER TABLE "Booking" ADD COLUMN "outsourceQuoteFilename" TEXT;
