-- Optional supporting-document attachment alongside the booking remark
-- (e.g. an official memo). attachmentUrl is a storage ref written by
-- lib/storage.ts; attachmentFilename keeps the original name for download.
ALTER TABLE "Booking" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "Booking" ADD COLUMN "attachmentFilename" TEXT;
