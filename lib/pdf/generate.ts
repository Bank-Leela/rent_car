import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/db";
import { readSignatureBytes, writeBookingPdf } from "@/lib/storage";
import { BookingRequestPdf } from "./booking-pdf";

/**
 * Render the booking request PDF and persist it. Returns the storage ref
 * (e.g. "pdf:abc123.pdf") which is then written to Booking.pdfUrl.
 */
export async function generateBookingPdf(bookingId: string): Promise<string> {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: {
      requester: true,
      department: true,
      vehicle: true,
      primaryDriver: { include: { user: true } },
      secondaryDriver: { include: { user: true } },
      approvals: { include: { approver: true }, orderBy: { createdAt: "desc" } },
    },
  });

  // Embed approver signature image if one exists.
  const decided = booking.approvals.find((a) => a.status === "APPROVED" || a.status === "DENIED");
  let signatureDataUri: string | null = null;
  const sigRef = decided?.signatureImageUrl ?? decided?.approver.signatureImageUrl ?? null;
  if (sigRef) {
    const bytes = await readSignatureBytes(sigRef);
    if (bytes) {
      const ext = sigRef.endsWith(".jpg") ? "jpeg" : "png";
      signatureDataUri = `data:image/${ext};base64,${bytes.toString("base64")}`;
    }
  }

  const buffer = await renderToBuffer(
    BookingRequestPdf({ booking, signatureDataUri }),
  );
  return writeBookingPdf(bookingId, buffer);
}
