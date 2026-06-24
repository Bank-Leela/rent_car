-- Sub-project A: stored Google-Maps link on bookings + per-requester saved places.

ALTER TABLE "Booking" ADD COLUMN "googleMapsUrl" TEXT;

CREATE TABLE "SavedPlace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "province" TEXT NOT NULL,
  "googleMapsUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedPlace_user_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "SavedPlace_userId_idx" ON "SavedPlace"("userId");
