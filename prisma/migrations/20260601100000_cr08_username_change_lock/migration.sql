-- CR-08 follow-up: lock username changes to one per user.
-- usernameChangedAt is null until the user takes their one change; after
-- that the input is locked on /account and only an admin can change it.

ALTER TABLE "User" ADD COLUMN "usernameChangedAt" TIMESTAMP(3);
