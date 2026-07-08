// Pure request/response shaping for Adobe Acrobat Sign REST v6 — no I/O, so the
// payloads and event parsing are unit-testable without credentials.

export type Signer = { email: string; name?: string };

// Body for POST /api/rest/v6/agreements. One participant set (the department
// head), order 1, e-signature, sent immediately (IN_PROCESS).
export function buildAgreementBody(opts: {
  transientDocumentId: string;
  name: string;
  signer: Signer;
}) {
  return {
    fileInfos: [{ transientDocumentId: opts.transientDocumentId }],
    name: opts.name,
    participantSetsInfo: [
      {
        order: 1,
        role: "SIGNER" as const,
        memberInfos: [{ email: opts.signer.email }],
      },
    ],
    signatureType: "ESIGN" as const,
    state: "IN_PROCESS" as const,
  };
}

export type WebhookOutcome =
  | { kind: "completed"; agreementId: string }
  | { kind: "cancelled"; agreementId: string }
  | { kind: "ignored" };

// Adobe posts { event, agreement: { id }, ... }. We act only on terminal
// events; everything else is ignored.
export function parseWebhookEvent(body: unknown): WebhookOutcome {
  if (!body || typeof body !== "object") return { kind: "ignored" };
  const b = body as Record<string, unknown>;
  const event = typeof b.event === "string" ? b.event : "";
  const agreement = (b.agreement ?? b.agreementInfo) as Record<string, unknown> | undefined;
  const agreementId = agreement && typeof agreement.id === "string" ? agreement.id : "";
  if (!agreementId) return { kind: "ignored" };
  if (event === "AGREEMENT_WORKFLOW_COMPLETED") return { kind: "completed", agreementId };
  if (event === "AGREEMENT_ACTION_DELEGATED") return { kind: "ignored" };
  if (event === "AGREEMENT_REJECTED" || event === "AGREEMENT_CANCELLED" || event === "AGREEMENT_EXPIRED") {
    return { kind: "cancelled", agreementId };
  }
  return { kind: "ignored" };
}
