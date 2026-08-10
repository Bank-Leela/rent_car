import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { fillVehicleForm, type SignatureImage } from "@/lib/pdf/official-form";
import { readSignatureBytes } from "@/lib/storage";
import { isStationEmail } from "@/lib/auth/station";
import { formatTh } from "@/lib/format-date";

// The official form carries no number of its own, so the download is named for
// the trip: start date + ปลายทาง, which is how a person recognises it in a
// folder of printed forms. Both parts are user-controlled free text, so the
// header is built defensively — the RFC 5987 `filename*` keeps the Thai, and the
// plain `filename=` fallback is stripped to ASCII for clients that ignore it.
function pdfDispositionFor(startAt: Date, destination: string): string {
  const date = formatTh(startAt, "yyyy-MM-dd");
  // Drop the characters that end a header value or a path segment (CR/LF and
  // other controls, quotes, backslash, slash) before anything else.
  const dest = destination
    .replace(/[\x00-\x1f\x7f"\\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  const utf8 = dest ? `${date} ${dest}.pdf` : `${date}.pdf`;
  const asciiDest = dest.replace(/[^\x20-\x7e]+/g, " ").replace(/\s+/g, " ").trim();
  const ascii = asciiDest ? `${date} ${asciiDest}.pdf` : `${date}.pdf`;
  // encodeURIComponent leaves ' ( ) * alone, none of which are attr-char.
  const encoded = encodeURIComponent(utf8).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

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

  // Access: the requester, the dept head, any ADMIN — and the driver running the
  // trip. The driver carries the printed form so the passenger can sign that the
  // trip was completed, so they need to be able to open it from the station.
  // Same rule the driver trip page uses: the shared station kiosk, or the driver
  // actually assigned to this booking (primary or co-driver).
  const userId = session.user.id;
  const isAdmin = session.user.roles.includes("ADMIN");
  const isOwner = booking.requesterId === userId;
  const isHead = booking.department?.headUserId === userId;
  let isAssignedDriver = false;
  if (!(isAdmin || isOwner || isHead) && session.user.roles.includes("DRIVER")) {
    if (isStationEmail(session.user.email)) {
      isAssignedDriver = true;
    } else {
      const me = await prisma.driver.findUnique({
        where: { userId },
        select: { id: true },
      });
      isAssignedDriver =
        !!me && (booking.primaryDriverId === me.id || booking.secondaryDriverId === me.id);
    }
  }
  if (!(isAdmin || isOwner || isHead || isAssignedDriver)) {
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
      headName: booking.department?.head?.signatureName ?? booking.department?.head?.name ?? null,
    },
    signatureImage,
  );

  return new NextResponse(Buffer.from(bytes) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": pdfDispositionFor(booking.startAt, booking.destination),
    },
  });
}
