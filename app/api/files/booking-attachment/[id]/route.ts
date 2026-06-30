import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { readBookingAttachment } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      attachmentUrl: true,
      attachmentFilename: true,
      requesterId: true,
      department: { select: { headUserId: true, head: { select: { delegatedToUserId: true } } } },
    },
  });
  if (!booking || !booking.attachmentUrl) return new NextResponse("Not found", { status: 404 });

  // Access: requester, the dept head (or their delegate), or any ADMIN
  // — same circle as the booking PDF.
  const userId = session.user.id;
  const isStaff = session.user.roles.includes("ADMIN");
  const isOwner = booking.requesterId === userId;
  const isHead = booking.department.headUserId === userId;
  const isDelegate = booking.department.head?.delegatedToUserId === userId;
  if (!(isStaff || isOwner || isHead || isDelegate)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const bytes = await readBookingAttachment(booking.attachmentUrl);
  if (!bytes) return new NextResponse("Not found", { status: 404 });

  // Content-Disposition is an HTTP header — it can only hold ASCII/Latin-1
  // bytes. The filename is requester-supplied and often Thai, so encode it
  // per RFC 5987 (filename*=UTF-8''...) with an ASCII fallback for clients
  // that don't understand the extended form.
  const rawName = booking.attachmentFilename ?? "attachment";
  const asciiFallback = rawName.replace(/[^\x20-\x7E]/g, "_");
  const encodedName = encodeURIComponent(rawName);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
    },
  });
}
