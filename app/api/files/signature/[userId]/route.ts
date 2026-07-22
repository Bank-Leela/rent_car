import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { readSignatureBytes } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { userId } = await params;
  const isAdmin = session.user.roles.includes("ADMIN");
  const isOwner = session.user.id === userId;
  if (!(isAdmin || isOwner)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { signatureImageUrl: true },
  });
  if (!user?.signatureImageUrl) return new NextResponse("Not found", { status: 404 });

  const bytes = await readSignatureBytes(user.signatureImageUrl);
  if (!bytes) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": user.signatureImageUrl.endsWith(".png") ? "image/png" : "image/jpeg",
      "Cache-Control": "private, max-age=60",
    },
  });
}
