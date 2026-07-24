import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { fillVehicleForm, type SignatureImage } from "@/lib/pdf/official-form";
import { readSignatureBytes } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      requester: true,
      department: { include: { head: true } },
      vehicle: true,
      primaryDriver: { include: { user: true } },
      trip: true,
      approvals: { include: { approver: true }, orderBy: { createdAt: "desc" } },
    },
  });
  // pdfUrl is set at approval — the official form is offered once decided.
  if (!booking || !booking.pdfUrl) return new NextResponse("Not found", { status: 404 });

  // Access: the requester, the dept head, or any ADMIN.
  const userId = session.user.id;
  const isAdmin = session.user.roles.includes("ADMIN");
  const isOwner = booking.requesterId === userId;
  const isHead = booking.department?.headUserId === userId;
  if (!(isAdmin || isOwner || isHead)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // The DEPARTMENT HEAD's registered signature, stamped into the head signature
  // box. The requester + driver sign the printed copy by hand. Null (no head set,
  // or head hasn't registered a signature) → the box is simply left blank.
  let signatureImage: SignatureImage | null = null;
  const headSigUrl = booking.department?.head?.signatureImageUrl;
  if (headSigUrl) {
    const sigBytes = await readSignatureBytes(headSigUrl);
    if (sigBytes) {
      signatureImage = { bytes: sigBytes, isPng: headSigUrl.endsWith(".png") };
    }
  }

  // Rendered live so the approval + driver + trip sections reflect current state.
  const decided = booking.approvals.find((a) => a.status === "APPROVED" || a.status === "DENIED");
  const bytes = await fillVehicleForm(
    {
      ...booking,
      approverName: decided?.approver.name ?? null,
      denialReason: booking.denialReason ?? null,
    },
    signatureImage,
  );

  return new NextResponse(Buffer.from(bytes) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${booking.jobNumber}.pdf"`,
    },
  });
}
