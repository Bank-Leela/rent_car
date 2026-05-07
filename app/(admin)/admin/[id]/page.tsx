import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { findBufferConflicts, shouldWarnAboutCancellations } from "@/lib/booking/rules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { AssignForm, DenyForm } from "@/components/forms/assign-form";
import { subDays } from "date-fns";

export default async function AdminBookingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN");
  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      requester: true,
      department: true,
      vehicle: true,
      primaryDriver: { include: { user: true } },
      secondaryDriver: { include: { user: true } },
      auditLogs: { orderBy: { createdAt: "asc" }, include: { actor: true } },
    },
  });
  if (!booking) notFound();

  const [vehicles, drivers, otherBookingsByVehicle, recentCancellations] = await Promise.all([
    prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { registrationNumber: "asc" } }),
    prisma.driver.findMany({
      where: { isActive: true },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.booking.findMany({
      where: {
        status: { in: ["APPROVED", "ASSIGNED"] },
        id: { not: booking.id },
        vehicleId: { not: null },
      },
      select: { id: true, vehicleId: true, startAt: true, endAt: true },
    }),
    prisma.cancellation.count({
      where: {
        booking: { requesterId: booking.requesterId },
        cancelledAt: { gte: subDays(new Date(), 90) },
      },
    }),
  ]);

  const conflictsByVehicle = new Map<string, number>();
  for (const v of vehicles) {
    const others = otherBookingsByVehicle.filter((o) => o.vehicleId === v.id);
    const conflicts = findBufferConflicts(
      { startAt: booking.startAt, endAt: booking.endAt },
      others,
    );
    conflictsByVehicle.set(v.id, conflicts.length);
  }

  const vehicleOptions = vehicles.map((v) => {
    const conflictCount = conflictsByVehicle.get(v.id) ?? 0;
    return {
      id: v.id,
      label: `${v.registrationNumber} · ${v.type.toLowerCase()} · ${v.capacity}-seat`,
      sublabel: v.isReserved ? "reserved" : undefined,
      disabled: conflictCount > 0,
      conflict: conflictCount > 0,
    };
  });
  const driverOptions = drivers.map((d) => ({
    id: d.id,
    label: d.user.name ?? d.user.email ?? "Unknown driver",
    sublabel: `${d.pool.toLowerCase()} pool`,
  }));

  const isQueueable = booking.status === "PENDING_APPROVAL" || booking.status === "APPROVED";
  const cancellationWarning = shouldWarnAboutCancellations(recentCancellations);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{booking.jobNumber}</span>
            <BookingStatusBadge status={booking.status} />
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{booking.purpose}</h1>
          <p className="text-sm text-muted-foreground">
            {booking.requester.name ?? booking.requester.email} · {booking.department.nameEn}
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          Back to queue
        </Link>
      </div>

      {cancellationWarning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠ Requester has cancelled {recentCancellations} bookings in the last 90 days.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Trip</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <Field label="Destination" value={`${booking.destination}, ${booking.province}`} />
          <Field label="Passengers" value={String(booking.passengerCount)} />
          <Field label="Start" value={format(booking.startAt, "EEE d MMM yyyy HH:mm")} />
          <Field label="End (back at faculty)" value={format(booking.endAt, "EEE d MMM yyyy HH:mm")} />
          {booking.estimatedDistance != null && (
            <Field label="Estimated distance" value={`${booking.estimatedDistance} km`} />
          )}
          {booking.needsOutsourcing && <Field label="Flag" value="Requester flagged for outsourcing" />}
          {booking.passengerNotes && (
            <Field label="Passenger notes" value={booking.passengerNotes} colSpan />
          )}
        </CardContent>
      </Card>

      {booking.vehicle && (
        <Card>
          <CardHeader>
            <CardTitle>Current assignment</CardTitle>
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

      {isQueueable && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Assign vehicle &amp; driver</CardTitle>
            </CardHeader>
            <CardContent>
              <AssignForm
                bookingId={booking.id}
                estimatedDistance={booking.estimatedDistance}
                vehicleOptions={vehicleOptions}
                driverOptions={driverOptions}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Deny</CardTitle>
            </CardHeader>
            <CardContent>
              <DenyForm bookingId={booking.id} />
            </CardContent>
          </Card>
        </>
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
