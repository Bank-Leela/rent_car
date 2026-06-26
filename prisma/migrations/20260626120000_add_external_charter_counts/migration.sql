-- External charter (jobType SMUS): how many outside buses/vans the requester
-- needs. Null for every non-SMUS booking. These trips bypass internal vehicle
-- + driver allocation and the slot system entirely.
ALTER TABLE "Booking" ADD COLUMN "externalBusCount" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "externalVanCount" INTEGER;
