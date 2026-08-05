import Link from "next/link";
import { format } from "date-fns";
import { ChevronRight } from "lucide-react";
import { BookingStatus } from "@prisma/client";
import { BookingStatusBadge } from "@/components/booking-status-badge";

// In-flight requests the requester is still tracking.
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.DRAFT,
  BookingStatus.PENDING_APPROVAL,
  BookingStatus.WAITLIST,
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
  jobNumber: string;
  status: BookingStatus;
  purpose: string;
  destination: string;
  province: string;
  startAt: Date;
  vehicle: { registrationNumber: string } | null;
};

export function RequesterBookingList({ bookings }: { bookings: RequesterBookingCard[] }) {
  return (
    <ul className="space-y-2">
      {bookings.map((b) => (
        <li key={b.id}>
          <Link
            href={`/requester/${b.id}`}
            className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                <BookingStatusBadge status={b.status} />
              </div>
              <div className="mt-1 font-medium truncate">{b.purpose}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM yyyy HH:mm")}
                {b.vehicle ? ` · ${b.vehicle.registrationNumber}` : ""}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
