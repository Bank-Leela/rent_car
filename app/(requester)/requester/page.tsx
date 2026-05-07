import Link from "next/link";
import { format } from "date-fns";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookingStatusBadge } from "@/components/booking-status-badge";

export default async function RequesterHome() {
  const session = await requireRole("REQUESTER");
  const bookings = await prisma.booking.findMany({
    where: { requesterId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { vehicle: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My bookings</h1>
          <p className="text-muted-foreground">Submit and track your vehicle requests.</p>
        </div>
        <Link
          href="/requester/new"
          className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New booking
        </Link>
      </div>

      {bookings.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No bookings yet</CardTitle>
            <CardDescription>Click &ldquo;New booking&rdquo; to submit your first request.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <Link
              key={b.id}
              href={`/requester/${b.id}`}
              className="block rounded-lg border bg-card p-4 hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-muted-foreground">{b.jobNumber}</span>
                    <BookingStatusBadge status={b.status} />
                  </div>
                  <div className="mt-1 font-medium">{b.purpose}</div>
                  <div className="text-sm text-muted-foreground">
                    {b.destination}, {b.province} ·{" "}
                    {format(b.startAt, "EEE d MMM yyyy HH:mm")}
                    {b.vehicle ? ` · ${b.vehicle.registrationNumber}` : ""}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
