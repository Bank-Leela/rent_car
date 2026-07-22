-- Signature moves to the requester (name label + image), replacing the Adobe
-- Sign e-signature flow. Delegation ("ผู้รับมอบ") is removed entirely.

-- User: add signatureName (signatureImageUrl already exists); drop delegation.
ALTER TABLE "User" ADD COLUMN "signatureName" TEXT;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_delegatedToUserId_fkey";
ALTER TABLE "User" DROP COLUMN IF EXISTS "delegatedToUserId";

-- Approval: the old approver-signature stamp is unused now.
ALTER TABLE "Approval" DROP COLUMN IF EXISTS "signatureImageUrl";

-- Booking: drop the Adobe Sign integration columns.
ALTER TABLE "Booking" DROP COLUMN IF EXISTS "adobeAgreementId";
ALTER TABLE "Booking" DROP COLUMN IF EXISTS "adobeSignStatus";
ALTER TABLE "Booking" DROP COLUMN IF EXISTS "signedPdfUrl";
