-- A stage between approval and getting a car: the official form has been
-- generated but the signed paperwork is not back yet. BEFORE 'APPROVED' so the
-- enum's own order still reads as the real sequence, in case anything ever
-- sorts or compares on it.
ALTER TYPE "BookingStatus" ADD VALUE 'AWAITING_DOCUMENT' BEFORE 'APPROVED';
