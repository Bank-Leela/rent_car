import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { FileText } from "lucide-react";
import { th, enUS } from "date-fns/locale";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { isStationEmail } from "@/lib/auth/station";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { StartTripForm, EndTripForm } from "@/components/forms/trip-forms";
import { DetailField } from "@/components/detail-field";

export default async function DriverBookingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("DRIVER");
  const { id } = await params;
  const t = await getTranslations("driverDetail");
  const tc = await getTranslations("common");
  const ttf = await getTranslations("tripForms");
  const dfLocale = (await getLocale()).toLowerCase().startsWith("th") ? th : enUS;

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

  const me = await prisma.driver.findUnique({ where: { userId: session.user.id } });
  const meId = me?.id;
  // Trip-execution page only. P'Top decides assignments (drivers no longer
  // self-claim on a board), so only the assigned driver — or the shared station
  // kiosk that records trips on their behalf — may view it.
  const canView =
    isStationEmail(session.user.email) ||
    booking.primaryDriverId === meId ||
    booking.secondaryDriverId === meId;
  if (!canView) notFound();

  const tripStarted = !!booking.trip;
  const tripCompleted = !!booking.trip?.endedAt;
  // Late finish (เลิกช้า → flag OT): actual end past the scheduled return time.
  // Derived — no stored flag needed. Rounded up to the minute.
  const overtimeMin =
    booking.trip?.endedAt && booking.trip.endedAt > booking.endAt
      ? Math.ceil((booking.trip.endedAt.getTime() - booking.endAt.getTime()) / 60000)
      : 0;

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
          {tc("back")}
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("trip")}</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-base">
          <Field label={t("vehicle")} value={booking.vehicle?.registrationNumber ?? "—"} />
          <Field
            label={t("capacity")}
            value={booking.vehicle ? t("capacityValue", { seats: booking.vehicle.capacity }) : "—"}
          />
          <Field label={t("start")} value={format(booking.startAt, "EEE d MMM HH:mm", { locale: dfLocale })} />
          <Field label={t("endBackAtFaculty")} value={format(booking.endAt, "EEE d MMM HH:mm", { locale: dfLocale })} />
          <Field label={t("passengers")} value={String(booking.passengerCount)} />
          {booking.estimatedDistance != null && (
            <Field label={t("estDistance")} value={`${booking.estimatedDistance} km`} />
          )}
          <Field
            label={t("waitAtDestination")}
            value={booking.waitAtDestination ? t("waits") : t("doesNotWait")}
          />
          {booking.pickupReturnTime && (
            <Field label={t("pickupReturnTime")} value={booking.pickupReturnTime} />
          )}
          {booking.waitingLocation && (
            <Field label={t("waitingLocation")} value={booking.waitingLocation} />
          )}
          <Field
            label={t("contact")}
            value={`${booking.requester.name ?? booking.requester.email}${booking.requester.phone ? ` · ${booking.requester.phone}` : ""}`}
            colSpan
          />
          {booking.passengerNotes && (
            <Field label={t("notes")} value={booking.passengerNotes} colSpan />
          )}
        </CardContent>
      </Card>

      {booking.ajarnName && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t("ajarnSection")}</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-base">
            <Field label={t("ajarnName")} value={booking.ajarnName} />
            <Field label={t("ajarnPhone")} value={booking.ajarnPhone} />
            <Field label={t("ajarnEmail")} value={booking.ajarnEmail} colSpan />
            {booking.coordinatorName && (
              <>
                <Field label={t("coordinatorName")} value={booking.coordinatorName} />
                <Field label={t("coordinatorPhone")} value={booking.coordinatorPhone} />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* The driver carries the printed form so the passenger can sign that the
          trip was completed, so it has to be reachable from the station — not
          just from the requester's and admin's pages. */}
      {booking.pdfUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t("formTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("formDescription")}</p>
            <Link
              href={`/api/files/booking-pdf/${booking.id}`}
              target="_blank"
              rel="noopener"
              className="inline-flex h-14 items-center gap-2 rounded-md border bg-background px-5 text-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FileText className="h-5 w-5" aria-hidden />
              {t("formOpen")}
            </Link>
          </CardContent>
        </Card>
      )}

      {!tripStarted && booking.status === "ASSIGNED" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t("startTripTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <StartTripForm bookingId={booking.id} />
          </CardContent>
        </Card>
      )}

      {tripStarted && !tripCompleted && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t("endTripTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {ttf("startedAt", {
                time: format(booking.trip!.startedAt, "HH:mm"),
                km: booking.trip!.startMileage.toLocaleString(),
              })}
            </p>
            <EndTripForm bookingId={booking.id} startMileage={booking.trip?.startMileage ?? null} />
          </CardContent>
        </Card>
      )}

      {tripCompleted && booking.trip && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t("completedTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-base">
            <Field label={t("completedStart")} value={`${booking.trip.startMileage.toLocaleString()} km`} />
            <Field label={t("completedEnd")} value={`${booking.trip.endMileage?.toLocaleString() ?? "—"} km`} />
            <Field label={t("completedDistance")} value={`${booking.trip.distanceKm ?? "—"} km`} />
            {booking.trip.fuelCost != null && (
              <Field label={t("completedFuel")} value={`฿${booking.trip.fuelCost.toString()}`} />
            )}
            {booking.trip.fuelLiters != null && (
              <Field label={t("completedFuelLiters")} value={`${booking.trip.fuelLiters.toString()} L`} />
            )}
            {booking.trip.fuelType && (
              <Field label={t("completedFuelType")} value={booking.trip.fuelType} />
            )}
            {booking.trip.tollwayCost != null && (
              <Field label={t("completedTollway")} value={`฿${booking.trip.tollwayCost.toString()}`} />
            )}
            {booking.trip.parkingCost != null && (
              <Field label={t("completedParking")} value={`฿${booking.trip.parkingCost.toString()}`} />
            )}
            {overtimeMin > 0 && (
              <Field
                label={t("completedOvertime")}
                value={t("overtimeValue", { min: overtimeMin, at: format(booking.endAt, "HH:mm") })}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Driver pages render slightly larger labels than the other detail pages.
function Field(props: Omit<React.ComponentProps<typeof DetailField>, "labelClassName">) {
  return <DetailField labelClassName="text-sm" {...props} />;
}
