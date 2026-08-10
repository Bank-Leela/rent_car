-- The VB-YYYYMM-NNNN job number is gone. Nobody read it: it was off every
-- screen already, the official form never carried it (only the downloaded
-- file's name did), and a booking is identified by ชื่อการจอง — what it is
-- called — plus its destination and time. Keeping a unique sequence nobody
-- uses meant an advisory lock and a count on every single booking insert.
--
-- Destructive and one-way: existing numbers are not recoverable after this.
DROP INDEX IF EXISTS "Booking_jobNumber_key";
ALTER TABLE "Booking" DROP COLUMN "jobNumber";
