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
      department: { select: { headUserId: true, head: { select: { delegatedToUserId: true } } } },
    },
  });
  if (!booking || !booking.outsourceQuoteUrl) return new NextResponse("Not found", { status: 404 });

  const userId = session.user.id;
  const isStaff = session.user.roles.includes("ADMIN");
  const isOwner = booking.requesterId === userId;
  const isHead = booking.department?.headUserId === userId;
  const isDelegate = booking.department?.head?.delegatedToUserId === userId;
  if (!(isStaff || isOwner || isHead || isDelegate)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const bytes = await readOutsourceQuote(booking.outsourceQuoteUrl);
  if (!bytes) return new NextResponse("Not found", { status: 404 });

  const name = booking.outsourceQuoteFilename ?? "quote";
  return new NextResponse(new Uint8Array(bytes) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}
