import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { TWO_DRIVER_DISTANCE_KM } from "@/lib/booking/rules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { StartTripForm, EndTripForm } from "@/components/forms/trip-forms";
import {
  ClaimButton,
  ReleaseButton,
  ConfirmScheduleButton,
} from "@/components/forms/claim-form";
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

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      requester: true,
      vehicle: true,
      department: true,
      primaryDriver: { include: { user: true } },
      secondaryDriver: { include: { user: true } },
      claims: { where: { status: "ACTIVE" }, include: { driver: { include: { user: true } } } },
      trip: true,
    },
  });
  if (!booking) notFound();

  const me = await prisma.driver.findUnique({ where: { userId: session.user.id } });
  const meId = me?.id;
  // CR-02: any driver can view an APPROVED trip on the board; only claimed
  // drivers see it after the schedule is confirmed.
  const isClaimed = !!booking.claims.find((c) => c.driverId === meId);
  const canViewPostAssign = booking.primaryDriverId === meId || booking.secondaryDriverId === meId;
  if (booking.status === "APPROVED") {
    // anyone in the pool may view to decide whether to claim
  } else if (!canViewPostAssign && !isClaimed) {
    notFound();
  }

  const tripStarted = !!booking.trip;
  const tripCompleted = !!booking.trip?.endedAt;
  const primaryClaim = booking.claims.find((c) => c.role === "PRIMARY");
  const secondaryClaim = booking.claims.find((c) => c.role === "SECONDARY");
  const iAmPrimary = primaryClaim?.driverId === meId;
  const iAmSecondary = secondaryClaim?.driverId === meId;
  const iAmClaimed = iAmPrimary || iAmSecondary;
  const needsSecondary =
    typeof booking.estimatedDistance === "number" &&
    booking.estimatedDistance > TWO_DRIVER_DISTANCE_KM;
  const canConfirm =
    booking.status === "APPROVED" &&
    booking.driverScheduleStatus !== "CONFIRMED" &&
    iAmPrimary &&
    (!needsSecondary || !!secondaryClaim);
  const showClaimCard = booking.status === "APPROVED";

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
          <Field label={t("start")} value={format(booking.startAt, "EEE d MMM HH:mm")} />
          <Field label={t("endBackAtFaculty")} value={format(booking.endAt, "EEE d MMM HH:mm")} />
          <Field label={t("passengers")} value={String(booking.passengerCount)} />
          {booking.estimatedDistance != null && (
            <Field label={t("estDistance")} value={`${booking.estimatedDistance} km`} />
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

      {showClaimCard && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t("scheduleTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {needsSecondary
                ? t("scheduleHelperLong", { km: TWO_DRIVER_DISTANCE_KM })
                : t("scheduleHelper")}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <SlotCard
                label={t("primary")}
                takenBy={
                  primaryClaim
                    ? primaryClaim.driver.user.name ?? primaryClaim.driver.user.email
                    : null
                }
                iAm={iAmPrimary}
                meLabel={t("you")}
                bookingId={booking.id}
                role="PRIMARY"
                otherSlotTakenByMe={iAmSecondary}
              />
              <SlotCard
                label={t("secondary")}
                takenBy={
                  secondaryClaim
                    ? secondaryClaim.driver.user.name ?? secondaryClaim.driver.user.email
                    : null
                }
                iAm={iAmSecondary}
                meLabel={t("you")}
                bookingId={booking.id}
                role="SECONDARY"
                otherSlotTakenByMe={iAmPrimary}
              />
            </div>
            {iAmClaimed && (
              <div className="flex items-center gap-3 pt-2 border-t">
                <ReleaseButton bookingId={booking.id} />
                {canConfirm && <ConfirmScheduleButton bookingId={booking.id} />}
              </div>
            )}
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
            <EndTripForm bookingId={booking.id} />
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
            {booking.trip.tollwayCost != null && (
              <Field label={t("completedTollway")} value={`฿${booking.trip.tollwayCost.toString()}`} />
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

function SlotCard({
  label,
  takenBy,
  iAm,
  meLabel,
  bookingId,
  role,
  otherSlotTakenByMe,
}: {
  label: string;
  takenBy: string | null;
  iAm: boolean;
  meLabel: string;
  bookingId: string;
  role: "PRIMARY" | "SECONDARY";
  otherSlotTakenByMe: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {takenBy ? (
        <div className="mt-1 font-medium">{iAm ? meLabel : takenBy}</div>
      ) : (
        <div className="mt-2">
          <ClaimButton bookingId={bookingId} role={role} disabled={otherSlotTakenByMe} />
        </div>
      )}
    </div>
  );
}
