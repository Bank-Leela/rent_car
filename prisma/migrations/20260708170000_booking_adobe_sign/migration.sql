-- Adobe Acrobat Sign agreement tracking + signed-PDF ref.
ALTER TABLE "Booking" ADD COLUMN "adobeAgreementId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "adobeSignStatus" TEXT;
ALTER TABLE "Booking" ADD COLUMN "signedPdfUrl" TEXT;
