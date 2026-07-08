import { getAdobeSignConfig, type AdobeSignConfig } from "@/lib/adobe-sign/config";
import { buildAgreementBody, type Signer } from "@/lib/adobe-sign/agreement";

// Thin Adobe Acrobat Sign REST v6 client. Every call requires configuration;
// callers must gate on isAdobeSignConfigured() first. No global mutable state
// except a short-lived in-module access-token cache.

function requireConfig(): AdobeSignConfig {
  const cfg = getAdobeSignConfig();
  if (!cfg) throw new Error("Adobe Sign is not configured");
  return cfg;
}

let tokenCache: { token: string; expiresAt: number } | null = null;

// Refresh-token grant. The token endpoint lives on the account's shard.
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;
  const cfg = requireConfig();
  const res = await fetch(`https://api.${cfg.shard}.adobesign.com/oauth/v2/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Adobe Sign token refresh failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  tokenCache = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

// The real API host is discovered per access token (region-sharded).
async function getApiBase(token: string): Promise<string> {
  const cfg = requireConfig();
  const res = await fetch(`https://api.${cfg.shard}.adobesign.com/api/rest/v6/baseUris`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Adobe Sign baseUris failed: ${res.status}`);
  const json = (await res.json()) as { apiAccessPoint: string };
  return json.apiAccessPoint.replace(/\/$/, "");
}

async function authed(): Promise<{ token: string; base: string }> {
  const token = await getAccessToken();
  const base = await getApiBase(token);
  return { token, base };
}

// Upload the PDF as a transient document; returns its id for agreement creation.
async function uploadTransientDocument(pdf: Uint8Array, fileName: string): Promise<string> {
  const { token, base } = await authed();
  const form = new FormData();
  form.append("File-Name", fileName);
  form.append("Mime-Type", "application/pdf");
  form.append("File", new Blob([pdf as unknown as BlobPart], { type: "application/pdf" }), fileName);
  const res = await fetch(`${base}/api/rest/v6/transientDocuments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Adobe Sign transientDocuments failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { transientDocumentId: string };
  return json.transientDocumentId;
}

// Create + send the agreement to the single (head) signer. Returns agreement id.
export async function sendForSignature(opts: {
  pdf: Uint8Array;
  fileName: string;
  agreementName: string;
  signer: Signer;
}): Promise<string> {
  const transientDocumentId = await uploadTransientDocument(opts.pdf, opts.fileName);
  const { token, base } = await authed();
  const body = buildAgreementBody({ transientDocumentId, name: opts.agreementName, signer: opts.signer });
  const res = await fetch(`${base}/api/rest/v6/agreements`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Adobe Sign createAgreement failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  return json.id;
}

export async function getAgreementStatus(agreementId: string): Promise<string> {
  const { token, base } = await authed();
  const res = await fetch(`${base}/api/rest/v6/agreements/${agreementId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Adobe Sign getAgreement failed: ${res.status}`);
  const json = (await res.json()) as { status: string };
  return json.status;
}

// The flattened, fully-signed PDF.
export async function downloadSignedPdf(agreementId: string): Promise<Uint8Array> {
  const { token, base } = await authed();
  const res = await fetch(`${base}/api/rest/v6/agreements/${agreementId}/combinedDocument`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" },
  });
  if (!res.ok) throw new Error(`Adobe Sign combinedDocument failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Exposed for tests to clear the module-level token cache.
export function __resetTokenCache() {
  tokenCache = null;
}
