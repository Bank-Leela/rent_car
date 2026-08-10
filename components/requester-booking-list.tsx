import Link from "next/link";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import { ChevronRight } from "lucide-react";
import { BookingStatus, type JobType } from "@prisma/client";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { BookingDocumentLink } from "@/components/booking-document-link";

// In-flight requests the requester is still tracking.
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.DRAFT,
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.WAITLIST,
  // Approved, waiting on the signed form — still very much the requester's
  // in-flight trip, and the stage they are most likely to ask about.
  BookingStatus.AWAITING_DOCUMENT,
  BookingStatus.APPROVED,
  BookingStatus.ASSIGNED,
  // Handed to an outside driver — still an in-flight trip the requester tracks.
  BookingStatus.OUTSOURCED,
];

// Terminal requests shown on the history page.
export const HISTORY_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.DENIED,
  BookingStatus.CANCELLED,
];

export type RequesterBookingCard = {
  id: string;
  status: BookingStatus;
  jobType: JobType;
  purpose: string;
  destination: string;
  province: string;
  startAt: Date;
  vehicle: { registrationNumber: string } | null;
  /** The official form exists (generated at approval) — offer the download. */
  hasPdf: boolean;
};

export function RequesterBookingList({
  bookings,
  documentLabel,
}: {
  bookings: RequesterBookingCard[];
  documentLabel: string;
}) {
  return (
    <ul className="space-y-2">
      {bookings.map((b) => (
        <li key={b.id} className="rounded-xl border bg-card">
          <Link
            href={`/requester/${b.id}`}
            className="group flex items-start justify-between gap-4 rounded-xl p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <BookingStatusBadge status={b.status} />
              </div>
              <div className="mt-1 font-medium truncate">{b.purpose}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM yyyy HH:mm", { locale: th })}
                {b.vehicle ? ` · ${b.vehicle.registrationNumber}` : ""}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
          {/* Sibling of the Link, never inside it — an anchor nested in an
              anchor swallows one of the two clicks. */}
          {b.hasPdf && (
            <div className="px-4 pb-3">
              <BookingDocumentLink bookingId={b.id} label={documentLabel} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
