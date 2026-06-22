import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { POST } from "@/app/api/line/webhook/route";

const SECRET = "test-channel-secret";
const sign = (raw: string, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(raw).digest("base64");

function post(raw: string, signature?: string) {
  return new Request("http://localhost/api/line/webhook", {
    method: "POST",
    headers: signature ? { "x-line-signature": signature } : {},
    body: raw,
  });
}

describe("LINE webhook signature gate (fail-closed)", () => {
  const orig = process.env.LINE_CHANNEL_SECRET;
  afterEach(() => {
    if (orig === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = orig;
  });

  it("fails closed (503) when no channel secret is configured", async () => {
    delete process.env.LINE_CHANNEL_SECRET;
    const res = await POST(post("{}", "whatever"));
    expect(res.status).toBe(503);
  });

  it("rejects a forged / missing / wrong-secret signature (401)", async () => {
    process.env.LINE_CHANNEL_SECRET = SECRET;
    const raw = JSON.stringify({ events: [] });
    expect((await POST(post(raw, "wrong"))).status).toBe(401);
    expect((await POST(post(raw))).status).toBe(401); // missing header
    expect((await POST(post(raw, sign(raw, "other-secret")))).status).toBe(401);
  });

  it("accepts a correctly-signed payload (200)", async () => {
    process.env.LINE_CHANNEL_SECRET = SECRET;
    const raw = JSON.stringify({ events: [] });
    expect((await POST(post(raw, sign(raw)))).status).toBe(200);
  });

  it("rejects malformed JSON even when correctly signed (400)", async () => {
    process.env.LINE_CHANNEL_SECRET = SECRET;
    const raw = "{not json";
    expect((await POST(post(raw, sign(raw)))).status).toBe(400);
  });
});
