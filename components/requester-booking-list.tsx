import Link from "next/link";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import { ChevronRight } from "lucide-react";
import { BookingStatus, type JobType } from "@prisma/client";
import { BookingStatusBadge } from "@/components/booking-status-badge";

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
}: {
  bookings: RequesterBookingCard[];
  documentLabel: string;
}) {
  return (
    <ul className="space-y-2">
      {bookings.map((b) => (
        <li key={b.id} className="overflow-hidden rounded-xl border bg-card shadow-e1">
          <Link
            href={`/requester/${b.id}`}
            className="group flex items-center gap-4 p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {/* A date plate, so a log of forty rows can be scanned by when rather
                than read line by line. The date was previously the third item in
                one run-on grey sentence ("destination, province · EEE d MMM yyyy
                HH:mm · registration"), which is the least findable place for the
                thing people actually search a history by. */}
            <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <span className="text-base font-semibold leading-none tabular-nums text-foreground">
                {format(b.startAt, "d")}
              </span>
              <span className="text-[10px] font-medium uppercase leading-none tracking-wide">
                {format(b.startAt, "MMM", { locale: th })}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{b.purpose}</div>
              <div className="mt-0.5 truncate text-sm text-muted-foreground">
                {b.destination}, {b.province}
                <span className="tabular-nums"> · {format(b.startAt, "HH:mm", { locale: th })}</span>
                {b.vehicle ? ` · ${b.vehicle.registrationNumber}` : ""}
              </div>
            </div>
            {/* Status moves to the right rail where it lines up down the column,
                instead of sitting above the title where it pushed the row's real
                subject to second place. */}
            <div className="flex shrink-0 items-center gap-2">
              <BookingStatusBadge status={b.status} audience="requester" />
              <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
          {/* No official-form download on the requester's side. The form is the
              transport office's paperwork — printed, signed and filed by them —
              so it lives on the admin surfaces and on the driver's trip page
              (the driver carries the printed copy for the passenger to sign). */}
        </li>
      ))}
    </ul>
  );
}
