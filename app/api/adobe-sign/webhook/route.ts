import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdobeSignConfig } from "@/lib/adobe-sign/config";
import { parseWebhookEvent } from "@/lib/adobe-sign/agreement";
import { downloadSignedPdf } from "@/lib/adobe-sign/client";
import { writeSignedPdf } from "@/lib/storage";

// Adobe Acrobat Sign webhook.
//
// Adobe verifies both registration AND every delivery by requiring the client
// id echoed back — either in the `xAdobeSignClientId` response header or a JSON
// body of the same shape. We fail closed when unconfigured, and reject any
// delivery whose `X-AdobeSign-ClientId` header doesn't match ours.
function verifyClientId(req: Request): { ok: boolean; clientId: string } {
  const cfg = getAdobeSignConfig();
  if (!cfg) return { ok: false, clientId: "" };
  const header = req.headers.get("x-adobesign-clientid") ?? "";
  return { ok: header === cfg.clientId, clientId: cfg.clientId };
}

// Registration handshake: Adobe GETs the URL and expects the client id echoed.
export async function GET(req: Request) {
  const { ok, clientId } = verifyClientId(req);
  if (!ok) return new NextResponse("not configured", { status: 503 });
  return NextResponse.json({ xAdobeSignClientId: clientId }, {
    headers: { "X-AdobeSign-ClientId": clientId },
  });
}

export async function POST(req: Request) {
  const { ok, clientId } = verifyClientId(req);
  if (!ok) return new NextResponse("unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const outcome = parseWebhookEvent(body);
  // Always echo the client id (Adobe checks it on every delivery too).
  const echo = { headers: { "X-AdobeSign-ClientId": clientId } };

  if (outcome.kind === "ignored") return NextResponse.json({ ok: true }, echo);

  const booking = await prisma.booking.findFirst({
    where: { adobeAgreementId: outcome.agreementId },
    select: { id: true },
  });
  if (!booking) return NextResponse.json({ ok: true }, echo);

  if (outcome.kind === "cancelled") {
    await prisma.booking.update({ where: { id: booking.id }, data: { adobeSignStatus: "CANCELLED" } });
    return NextResponse.json({ ok: true }, echo);
  }

  // completed → fetch + store the signed PDF.
  try {
    const pdf = await downloadSignedPdf(outcome.agreementId);
    const ref = await writeSignedPdf(booking.id, Buffer.from(pdf));
    await prisma.booking.update({
      where: { id: booking.id },
      data: { adobeSignStatus: "SIGNED", signedPdfUrl: ref },
    });
  } catch (err) {
    console.error("[adobeSign] webhook download failed", err);
    // Mark signed but without the stored copy; a retry/poll can backfill.
    await prisma.booking.update({ where: { id: booking.id }, data: { adobeSignStatus: "SIGNED" } });
  }
  return NextResponse.json({ ok: true }, echo);
}
