import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { StartTripForm, EndTripForm } from "@/components/forms/trip-forms";

export default async function DriverBookingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("DRIVER");
  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      requester: true,
      vehicle: true,
      department: true,
      primaryDriver: { include: { user: true } },
      secondaryDriver: { include: { user: true } },
      trip: true,
    },
  });
  if (!booking) notFound();

  // Driver may only see their own assignments.
  const me = await prisma.driver.findUnique({ where: { userId: session.user.id } });
  const meId = me?.id;
  if (booking.primaryDriverId !== meId && booking.secondaryDriverId !== meId) notFound();

  const tripStarted = !!booking.trip;
  const tripCompleted = !!booking.trip?.endedAt;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{booking.jobNumber}</span>
            <BookingStatusBadge status={booking.status} />
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{booking.destination}</h1>
          <p className="text-base text-muted-foreground">{booking.purpose}</p>
        </div>
        <Link
          href="/driver"
          className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          Back
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Trip</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-base">
          <Field label="Vehicle" value={booking.vehicle?.registrationNumber ?? "—"} />
          <Field label="Capacity" value={`${booking.vehicle?.capacity ?? "—"} seats`} />
          <Field label="Start" value={format(booking.startAt, "EEE d MMM HH:mm")} />
          <Field label="End (back at faculty)" value={format(booking.endAt, "EEE d MMM HH:mm")} />
          <Field label="Passengers" value={String(booking.passengerCount)} />
          {booking.estimatedDistance != null && (
            <Field label="Est. distance" value={`${booking.estimatedDistance} km`} />
          )}
          <Field
            label="Contact"
            value={`${booking.requester.name ?? booking.requester.email}${booking.requester.phone ? ` · ${booking.requester.phone}` : ""}`}
            colSpan
          />
          {booking.passengerNotes && (
            <Field label="Notes" value={booking.passengerNotes} colSpan />
          )}
        </CardContent>
      </Card>

      {!tripStarted && booking.status === "ASSIGNED" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Start trip</CardTitle>
          </CardHeader>
          <CardContent>
            <StartTripForm bookingId={booking.id} />
          </CardContent>
        </Card>
      )}

      {tripStarted && !tripCompleted && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">End trip</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Started at {format(booking.trip!.startedAt, "HH:mm")} · {booking.trip!.startMileage.toLocaleString()} km
            </p>
            <EndTripForm bookingId={booking.id} />
          </CardContent>
        </Card>
      )}

      {tripCompleted && booking.trip && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Completed</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-base">
            <Field label="Start" value={`${booking.trip.startMileage.toLocaleString()} km`} />
            <Field label="End" value={`${booking.trip.endMileage?.toLocaleString() ?? "—"} km`} />
            <Field label="Distance" value={`${booking.trip.distanceKm ?? "—"} km`} />
            {booking.trip.fuelCost != null && <Field label="Fuel" value={`฿${booking.trip.fuelCost.toString()}`} />}
            {booking.trip.tollwayCost != null && <Field label="Tollway" value={`฿${booking.trip.tollwayCost.toString()}`} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value, colSpan }: { label: string; value: string; colSpan?: boolean }) {
  return (
    <div className={colSpan ? "sm:col-span-2" : ""}>
      <div className="text-sm uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
