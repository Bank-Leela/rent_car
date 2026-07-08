-- Add optional liters-pumped alongside the existing baht fuel cost.
ALTER TABLE "Trip" ADD COLUMN "fuelLiters" DECIMAL(10,2);
