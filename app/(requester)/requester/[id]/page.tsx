import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookingStatusBadge } from "@/components/booking-status-badge";

export default async function RequesterBookingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("REQUESTER");
  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      department: true,
      vehicle: true,
      primaryDriver: { include: { user: true } },
      secondaryDriver: { include: { user: true } },
      auditLogs: { orderBy: { createdAt: "asc" }, include: { actor: true } },
    },
  });
  if (!booking || booking.requesterId !== session.user.id) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{booking.jobNumber}</span>
            <BookingStatusBadge status={booking.status} />
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{booking.purpose}</h1>
        </div>
        <Link
          href="/requester"
          className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          Back
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trip</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <Field label="Destination" value={`${booking.destination}, ${booking.province}`} />
          <Field label="Department" value={booking.department.nameEn} />
          <Field label="Start" value={format(booking.startAt, "EEE d MMM yyyy HH:mm")} />
          <Field label="End (back at faculty)" value={format(booking.endAt, "EEE d MMM yyyy HH:mm")} />
          <Field label="Passengers" value={String(booking.passengerCount)} />
          {booking.estimatedDistance != null && (
            <Field label="Estimated distance" value={`${booking.estimatedDistance} km`} />
          )}
          {booking.passengerNotes && (
            <Field label="Passenger notes" value={booking.passengerNotes} colSpan />
          )}
        </CardContent>
      </Card>

      {booking.vehicle && (
        <Card>
          <CardHeader>
            <CardTitle>Assignment</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <Field label="Vehicle" value={booking.vehicle.registrationNumber} />
            <Field
              label="Driver"
              value={booking.primaryDriver?.user.name ?? booking.primaryDriver?.user.email ?? "—"}
            />
            {booking.secondaryDriver && (
              <Field
                label="Co-driver"
                value={booking.secondaryDriver.user.name ?? booking.secondaryDriver.user.email!}
              />
            )}
          </CardContent>
        </Card>
      )}

      {booking.status === "DENIED" && booking.denialReason && (
        <Card>
          <CardHeader>
            <CardTitle>Denied</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{booking.denialReason}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm">
            {booking.auditLogs.map((log) => (
              <li key={log.id} className="flex gap-3">
                <span className="text-muted-foreground tabular-nums">
                  {format(log.createdAt, "d MMM HH:mm")}
                </span>
                <span>
                  <span className="font-medium">{log.action.replace(/_/g, " ").toLowerCase()}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    by {log.actor.name ?? log.actor.email}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, colSpan }: { label: string; value: string; colSpan?: boolean }) {
  return (
    <div className={colSpan ? "sm:col-span-2" : ""}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
