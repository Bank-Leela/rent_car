import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// LINE webhook receiver. Channels are linked by storing the LINE userId on
// User.lineUserId. The user kicks off linking by sending us their faculty email
// in a chat message; we look up the user by email and bind the LINE userId.

export async function POST(req: Request) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  const raw = await req.text();
  if (secret) {
    const signature = req.headers.get("x-line-signature") ?? "";
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    if (signature !== expected) return new NextResponse("invalid signature", { status: 401 });
  }

  let body: { events?: Array<{ type: string; source?: { userId?: string }; message?: { type: string; text?: string } }> } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  for (const event of body.events ?? []) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const text = event.message.text?.trim() ?? "";
    const lineUserId = event.source?.userId;
    if (!lineUserId) continue;
    const emailMatch = text.match(/[\w.+-]+@chula\.ac\.th/i);
    if (!emailMatch) continue;
    const email = emailMatch[0].toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) continue;
    await prisma.user.update({ where: { id: user.id }, data: { lineUserId } });
  }

  return new NextResponse("ok");
}
