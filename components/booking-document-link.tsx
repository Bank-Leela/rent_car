import { FileDown } from "lucide-react";

// Download the official form for one booking.
//
// The PDF is generated at approval and stored as `pdfUrl`, so there is nothing
// to offer before then — callers pass `hasPdf` and get nothing when it is false
// rather than a link that 404s. The route (`/api/files/booking-pdf/[id]`) does
// its own access check, so this is safe to render for every role that can see
// the card. Render it as a SIBLING of the card's <Link>, never inside it — an
// anchor nested in an anchor is invalid and swallows one of the two clicks.
export function BookingDocumentLink({
  bookingId,
  label,
  hasPdf = true,
  className = "",
}: {
  bookingId: string;
  label: string;
  hasPdf?: boolean;
  className?: string;
}) {
  if (!hasPdf) return null;
  return (
    <a
      href={`/api/files/booking-pdf/${bookingId}`}
      target="_blank"
      rel="noopener noreferrer"
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        className
      }
    >
      <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </a>
  );
}
