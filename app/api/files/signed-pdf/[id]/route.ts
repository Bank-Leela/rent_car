import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { readSignedPdf } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      jobNumber: true,
      requesterId: true,
      signedPdfUrl: true,
      department: { select: { headUserId: true, head: { select: { delegatedToUserId: true } } } },
    },
  });
  if (!booking || !booking.signedPdfUrl) return new NextResponse("Not found", { status: 404 });

  const userId = session.user.id;
  const isAdmin = session.user.roles.includes("ADMIN");
  const isOwner = booking.requesterId === userId;
  const isHead = booking.department?.headUserId === userId;
  const isDelegate = booking.department?.head?.delegatedToUserId === userId;
  if (!(isAdmin || isOwner || isHead || isDelegate)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const bytes = await readSignedPdf(id);
  if (!bytes) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(bytes) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${booking.jobNumber}-signed.pdf"`,
    },
  });
}
