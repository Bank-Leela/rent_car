import { describe, expect, it } from "vitest";
import { buildAgreementBody, parseWebhookEvent } from "./agreement";

describe("buildAgreementBody", () => {
  it("wires the transient doc + a single head signer, ESIGN, sent immediately", () => {
    const body = buildAgreementBody({
      transientDocumentId: "TD-1",
      name: "ขออนุมัติใช้ยานพาหนะ J-001",
      signer: { email: "head@chula.ac.th", name: "หัวหน้าภาควิชา" },
    });
    expect(body.fileInfos).toEqual([{ transientDocumentId: "TD-1" }]);
    expect(body.signatureType).toBe("ESIGN");
    expect(body.state).toBe("IN_PROCESS");
    expect(body.participantSetsInfo).toHaveLength(1);
    const set = body.participantSetsInfo[0];
    expect(set.order).toBe(1);
    expect(set.role).toBe("SIGNER");
    expect(set.memberInfos).toEqual([{ email: "head@chula.ac.th" }]);
  });
});

describe("parseWebhookEvent", () => {
  it("returns completed with the agreement id", () => {
    const out = parseWebhookEvent({ event: "AGREEMENT_WORKFLOW_COMPLETED", agreement: { id: "AG-9" } });
    expect(out).toEqual({ kind: "completed", agreementId: "AG-9" });
  });
  it("treats rejected/cancelled/expired as cancelled", () => {
    for (const event of ["AGREEMENT_REJECTED", "AGREEMENT_CANCELLED", "AGREEMENT_EXPIRED"]) {
      expect(parseWebhookEvent({ event, agreement: { id: "AG-1" } })).toEqual({ kind: "cancelled", agreementId: "AG-1" });
    }
  });
  it("ignores unrelated events + malformed bodies", () => {
    expect(parseWebhookEvent({ event: "AGREEMENT_CREATED", agreement: { id: "AG-1" } }).kind).toBe("ignored");
    expect(parseWebhookEvent({ event: "AGREEMENT_WORKFLOW_COMPLETED" }).kind).toBe("ignored"); // no id
    expect(parseWebhookEvent(null).kind).toBe("ignored");
    expect(parseWebhookEvent("nope").kind).toBe("ignored");
  });
});
