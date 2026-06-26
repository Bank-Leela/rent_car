-- car=driver (1:1): each vehicle has at most one assigned driver.
-- Additive only: nullable column + unique index + FK (ON DELETE SET NULL).

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN "assignedDriverId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_assignedDriverId_key" ON "Vehicle"("assignedDriverId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
