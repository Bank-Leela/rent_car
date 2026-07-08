# Adobe Acrobat Sign — setup

The integration is **dormant until these env vars are set**. With them absent,
the "Send for signature" button is hidden and all Adobe endpoints fail closed.

## 1. Get API access
Adobe Acrobat Sign REST API needs a **paid plan with API access** (Business /
Enterprise, or a developer account). In the Adobe Sign admin console:
**Account → Adobe Sign API → API Applications → Create** (an OAuth application).

## 2. OAuth application
- Create the app; note the **Client ID** and **Client Secret**.
- Configure the OAuth scopes: `agreement_write`, `agreement_read`,
  `agreement_send`, `webhook_write` (+ `user_login` for the consent step).
- Add a redirect URI you control (any HTTPS URL; used once to capture the code).

## 3. One-time consent → refresh token
Do the OAuth authorization-code grant once to obtain a **refresh token**:
1. Open the authorize URL (`https://secure.<shard>.adobesign.com/public/oauth/v2`)
   with your client id, redirect uri, and the scopes above.
2. Approve; copy the `code` from the redirect.
3. Exchange it at `https://api.<shard>.adobesign.com/oauth/v2/token`
   (`grant_type=authorization_code`) for `refresh_token`.
The refresh token is long-lived; the app mints access tokens from it.

`<shard>` is your account's data center (na1 / na2 / na3 / eu1 / eu2 / jp1 / au1
/ …). Find it in any Adobe Sign URL after login.

## 4. Environment variables
Add to your `.env` (never commit):

```
ADOBE_SIGN_CLIENT_ID=...
ADOBE_SIGN_CLIENT_SECRET=...
ADOBE_SIGN_REFRESH_TOKEN=...
ADOBE_SIGN_SHARD=na1
```

## 5. Webhook
Register a webhook (Adobe console → Webhooks, or the API) pointing at:

```
https://<your-app-host>/api/adobe-sign/webhook
```

- Scope: **agreement** events, at least `AGREEMENT_WORKFLOW_COMPLETED`
  (we also handle rejected/cancelled/expired).
- Adobe verifies the URL by GETting it and both registration + each delivery
  echo the client id — our route returns `X-AdobeSign-ClientId` / the
  `xAdobeSignClientId` body automatically, and rejects deliveries whose
  `X-AdobeSign-ClientId` header doesn't match.

## Flow in the app
1. Admin opens an approved booking → **Send for signature**.
2. We fill the official form, upload it as a transient document, and create an
   agreement with the **department head** (or delegate) as the sole signer.
3. Adobe emails the head; they sign.
4. The webhook fires `AGREEMENT_WORKFLOW_COMPLETED` → we download the signed PDF,
   store it, and show **Download signed document** on the booking.

## Scope notes / next steps
- Only the department head signs today. Driver + recipient signers (the other
  two signature fields) are a later participant-set addition.
- Signed PDFs are stored on local disk (`uploads/signed-pdfs/`), same caveat as
  the other uploads — move to durable storage (S3 / Vercel Blob) for production.
