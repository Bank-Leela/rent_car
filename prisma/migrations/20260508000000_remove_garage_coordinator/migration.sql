-- Drop GARAGE_COORDINATOR from Role enum.
-- Postgres doesn't support removing enum values directly; recreate the type.

ALTER TABLE "UserRole" ALTER COLUMN "role" TYPE text;

CREATE TYPE "Role_new" AS ENUM ('REQUESTER', 'APPROVER', 'ADMIN', 'DRIVER');

DELETE FROM "UserRole" WHERE "role" = 'GARAGE_COORDINATOR';

ALTER TABLE "UserRole" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::"Role_new");

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
