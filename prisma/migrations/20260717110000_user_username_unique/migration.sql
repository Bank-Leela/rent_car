/*
  Warnings:

  - A unique constraint covering the columns `[username]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- A partial unique index (WHERE username IS NOT NULL) was created manually on
-- some environments under this same name. Uniqueness semantics are identical
-- (Postgres treats NULLs as distinct), but Prisma does not recognize a partial
-- index as satisfying @unique, so replace it with the full index it expects.
DROP INDEX IF EXISTS "User_username_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
