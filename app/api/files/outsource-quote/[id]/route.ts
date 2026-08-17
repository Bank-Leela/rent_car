import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { readOutsourceQuote } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      requesterId: true,
      outsourceQuoteUrl: true,
      outsourceQuoteFilename: true,
      department: { select: { headUserId: true } },
    },
  });
  if (!booking || !booking.outsourceQuoteUrl) return new NextResponse("Not found", { status: 404 });

  const userId = session.user.id;
  const isStaff = session.user.roles.includes("ADMIN");
  const isOwner = booking.requesterId === userId;
  const isHead = booking.department?.headUserId === userId;
  if (!(isStaff || isOwner || isHead)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const bytes = await readOutsourceQuote(booking.outsourceQuoteUrl);
  if (!bytes) return new NextResponse("Not found", { status: 404 });

  // Same two-parameter header as the booking-attachment route (see its comment).
  // This one percent-encoded into the PLAIN `filename=`, which RFC 6266 says is
  // never decoded — so a Thai quote (ใบเสนอราคา-....pdf) saved as a literal
  // "%E0%B9%83%E0%B8%9A…" string. The extended form is the one that carries UTF-8.
  const rawName = booking.outsourceQuoteFilename ?? "quote";
  const asciiFallback = rawName.replace(/[^\x20-\x7E]/g, "_");
  const encodedName = encodeURIComponent(rawName);

  return new NextResponse(new Uint8Array(bytes) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
    },
  });
}
