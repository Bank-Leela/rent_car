-- Remove the APPROVER role. Strip it from users first, then drop the enum value.
-- Postgres can't drop an enum value in place, so the type is recreated.

-- 1. Strip the role from every user (admins handle approvals now).
DELETE FROM "UserRole" WHERE "role" = 'APPROVER';

-- 2. Recreate the Role enum without APPROVER and migrate the only column using it.
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('REQUESTER', 'ADMIN', 'DRIVER');
ALTER TABLE "UserRole" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
DROP TYPE "Role_old";
