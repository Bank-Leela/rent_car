-- CR-08: admin-managed credentials. Add username for login + recovery.
-- passwordHash + mustChangePassword + PasswordResetToken were already
-- added by the 20260527 cr07_credentials_auth migration.

ALTER TABLE "User" ADD COLUMN "username" TEXT;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username") WHERE "username" IS NOT NULL;
