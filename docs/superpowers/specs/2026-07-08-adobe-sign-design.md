# Adobe Acrobat Sign integration — design

**Date:** 2026-07-08 · **Status:** approved (brainstorm)

Send the filled official form (`lib/pdf/official-form.ts`) to Adobe Acrobat
Sign for the **department head's** signature, driven by a manual admin button,
with completion delivered by webhook. Everything is **gated behind env vars** —
the app has no Adobe API access yet, so the integration is inert (button hidden)
until credentials are added.

## Decisions (locked)
1. **Auth:** OAuth refresh-token flow (the supported path). Not built to run yet
   — no credentials. `isAdobeSignConfigured()` gates all UI + actions.
2. **Signers:** department head (or delegate) only, role SIGNER, order 1 →
   fills `Signature7_es_:signer:signature`.
3. **Completion:** webhook `POST /api/adobe-sign/webhook` (GET = Adobe intent
   verification). Verified by the `X-AdobeSign-ClientId` header.
4. **Trigger:** manual "Send for signature" button on `/admin/[id]`.

## Architecture
- **`lib/adobe-sign/config.ts`** — reads `ADOBE_SIGN_CLIENT_ID`,
  `ADOBE_SIGN_CLIENT_SECRET`, `ADOBE_SIGN_REFRESH_TOKEN`, `ADOBE_SIGN_SHARD`;
  `isAdobeSignConfigured()` → all four present.
- **`lib/adobe-sign/agreement.ts`** (pure, unit-tested) — `buildAgreementBody`,
  `parseWebhookEvent`. No I/O — the request/response shapes only.
- **`lib/adobe-sign/client.ts`** — thin REST v6 client:
  `getAccessToken` (refresh grant, cached in-module by expiry), `getApiBase`
  (`/baseUris`), `uploadTransientDocument`, `createAgreement`,
  `getAgreementStatus`, `downloadSignedPdf` (`/combinedDocument`). All throw on
  non-2xx; never called when unconfigured.
- **`lib/booking/adobe-sign-actions.ts`** — `sendForSignatureAction`
  (requireRole ADMIN; booking ∈ APPROVED/ASSIGNED/COMPLETED; head email
  required): fill form → upload transient → create agreement (head signer) →
  store `adobeAgreementId` + `adobeSignStatus="OUT_FOR_SIGNATURE"`; audit.
- **Webhook** `app/api/adobe-sign/webhook/route.ts` — GET returns
  `{ xAdobeSignClientId }`; POST verifies the header, on
  `AGREEMENT_WORKFLOW_COMPLETED` downloads the signed PDF, stores it
  (`writeSignedPdf`), sets `signedPdfUrl` + `adobeSignStatus="SIGNED"`.
- **Download** `app/api/files/signed-pdf/[id]/route.ts` — same access checks as
  booking-pdf; streams the stored signed PDF.
- **UI** on `/admin/[id]`: when configured + no agreement → "Send for
  signature"; when agreement exists → status chip; when SIGNED → download link.

## Schema (additive, nullable — no enum change)
`Booking.adobeAgreementId String?`, `adobeSignStatus String?`,
`signedPdfUrl String?`. Migration via hand-authored SQL + `migrate deploy`.
`BookingStatus` untouched (a string sub-status avoids churning every switch).

## Env (documented in docs/adobe-sign-setup.md — NOT committed to .env)
`ADOBE_SIGN_CLIENT_ID`, `ADOBE_SIGN_CLIENT_SECRET`, `ADOBE_SIGN_REFRESH_TOKEN`,
`ADOBE_SIGN_SHARD` (e.g. na1/eu2). Webhook verification reuses the client id.

## Verification
- Unit tests: `buildAgreementBody` (single head signer, ESIGN, IN_PROCESS,
  transient id wired), `parseWebhookEvent` (completed vs other), config guard.
- `typecheck && lint && vitest`.
- **Cannot** be end-to-end verified without live credentials — documented.
  When creds land: send a booking, sign as the head, confirm webhook stores the
  signed PDF.

## Out of scope
- Driver + recipient signers (start head-only; add participant sets later).
- Polling fallback (webhook only).
- Auto-send on approval (manual only).
- Editing `.env*` (forbidden without per-turn auth) — env documented in a setup doc.
