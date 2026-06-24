-- Make DriverUnavailability.date a DATE column (matches OnCallShift) so the
-- calendar-day match is timezone-robust and the unique key is one row per day.
ALTER TABLE "DriverUnavailability" ALTER COLUMN "date" TYPE DATE USING "date"::date;
