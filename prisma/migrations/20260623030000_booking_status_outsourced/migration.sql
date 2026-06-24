-- Off-algorithm status for a booking handed to an external driver on a per-day
-- ad-hoc board row.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'OUTSOURCED';
