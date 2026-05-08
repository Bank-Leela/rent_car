import Link from "next/link";
import { format } from "date-fns";
import { Plus, FileText, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default async function RequesterHome() {
  const session = await requireRole("REQUESTER");
  const bookings = await prisma.booking.findMany({
    where: { requesterId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { vehicle: true },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="My bookings"
        description="Submit and track your vehicle requests."
        actions={
          <Link
            href="/requester/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New booking
          </Link>
        }
      />

      {bookings.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No bookings yet"
          description="Submit your first request and it'll show up here while it's in flight."
          action={
            <Link
              href="/requester/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              New booking
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {bookings.map((b) => (
            <li key={b.id}>
              <Link
                href={`/requester/${b.id}`}
                className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
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
      )}
    </div>
  );
}
