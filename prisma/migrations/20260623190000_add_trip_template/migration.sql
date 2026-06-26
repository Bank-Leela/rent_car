-- CreateTable
CREATE TABLE "TripTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "pickupLocation" TEXT,
    "passengerCount" INTEGER NOT NULL DEFAULT 1,
    "maleCount" INTEGER,
    "femaleCount" INTEGER,
    "passengerNotes" TEXT,
    "ajarnName" TEXT NOT NULL DEFAULT '',
    "ajarnPhone" TEXT NOT NULL DEFAULT '',
    "ajarnEmail" TEXT NOT NULL DEFAULT '',
    "coordinatorName" TEXT NOT NULL DEFAULT '',
    "coordinatorPhone" TEXT NOT NULL DEFAULT '',
    "estimatedDistance" INTEGER,
    "preferredVehicleId" TEXT,
    "outOfProvince" BOOLEAN NOT NULL DEFAULT false,
    "outsideChula" BOOLEAN NOT NULL DEFAULT false,
    "needsOutsourcing" BOOLEAN NOT NULL DEFAULT false,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripTemplate_userId_idx" ON "TripTemplate"("userId");

-- AddForeignKey
ALTER TABLE "TripTemplate" ADD CONSTRAINT "TripTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
