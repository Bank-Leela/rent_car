-- Official-form usage section: fuel grade + parking cost.
ALTER TABLE "Trip" ADD COLUMN "fuelType" TEXT;
ALTER TABLE "Trip" ADD COLUMN "parkingCost" DECIMAL(10,2);
