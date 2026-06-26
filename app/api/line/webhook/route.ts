import crypto from "node:crypto";
import { NextResponse } from "next/server";

// LINE webhook receiver.
//
// Fail-closed: without a configured channel secret we cannot verify a request's
// authenticity, so we reject rather than trust it (the old code skipped the
// check entirely when the secret was unset — forged events were accepted).
//
// Account binding is intentionally NOT done here by matching a faculty email in
// the chat text: that bound lineUserId onto whichever user owned the first
// @chula.ac.th address in the message, with zero ownership proof — anyone could
// hijack another member's driver notifications. The proper flow is a one-time
// link code the user gets in-app and sends back; that needs a per-user code
// store and lands when the LINE channel actually goes live. Until then inbound
// events are authenticated but not acted on for binding.
export async function POST(req: Request) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  const raw = await req.text();

  if (!secret) {
    // Fail closed — we can't authenticate the sender.
    return new NextResponse("not configured", { status: 503 });
  }

  const signature = req.headers.get("x-line-signature") ?? "";
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("base64");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  try {
    JSON.parse(raw);
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  // Authenticated — acknowledge so LINE doesn't retry. (No binding-by-email.)
  return new NextResponse("ok");
}
