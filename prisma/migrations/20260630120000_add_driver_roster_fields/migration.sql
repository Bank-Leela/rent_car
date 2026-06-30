-- Roster fields for the admin driver-management page (follow the driver sheet).
-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "licenseType" TEXT,
ADD COLUMN     "nickname" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "position" TEXT,
ADD COLUMN     "retirementYear" INTEGER;
