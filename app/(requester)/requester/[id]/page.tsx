import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { CancelForm } from "@/components/forms/cancel-form";
import { EvaluationForm } from "@/components/forms/evaluation-form";
import { TimeChangeForm } from "@/components/forms/time-change-form";
import { DetailField as Field } from "@/components/detail-field";
import { InChulaChip } from "@/components/in-chula-chip";

export default async function RequesterBookingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("REQUESTER");
  const { id } = await params;
  const t = await getTranslations("bookingDetail");
  const tc = await getTranslations("common");
  const tr = await getTranslations("requesterDetail");
  // Reuse the booking-form field/value labels so the requester can review every
  // input they filled in (pickup, vehicle type, gender counts, one-way, etc.).
  const tf = await getTranslations("bookingForm");
  const vehicleTypeLabel = (v: string) =>
    ({
      VAN: tf("preferredVehicleVan"),
      TRUCK_6_WHEEL: tf("preferredVehicleTruck6Wheel"),
      PICKUP: tf("preferredVehiclePickup"),
      SEDAN_DEAN: tf("preferredVehicleSedanDean"),
      BUS_OUTSOURCED: tf("preferredVehicleBusOutsourced"),
    })[v] ?? v;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      department: true,
      vehicle: true,
      primaryDriver: { include: { user: true } },
      secondaryDriver: { include: { user: true } },
      trip: { include: { evaluation: true } },
      auditLogs: { orderBy: { createdAt: "asc" }, include: { actor: true } },
    },
  });
  if (!booking || booking.requesterId !== session.user.id) notFound();
  const canCancel = !["COMPLETED", "CANCELLED", "DENIED"].includes(booking.status);
  // Times are editable until the trip runs. Editing an ASSIGNED trip releases
  // its vehicle/driver back to the queue (see updateBookingTimeAction) — the
  // warning below tells the requester before they commit.
  const canEditTime =
    ["PENDING_APPROVAL", "APPROVED", "ASSIGNED"].includes(booking.status) &&
    booking.startAt > new Date();
  // CR-06 follow-up: legacy COMPLETED bookings predate the completeTripAction
  // flow and may have no Trip row. Allow evaluation whenever status=COMPLETED
  // and no Evaluation exists yet; the action will lazy-create the Trip.
  const evaluationSubmitted = !!booking.trip?.evaluation;
  const needsEval = booking.status === "COMPLETED" && !evaluationSubmitted;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{booking.jobNumber}</span>
            <BookingStatusBadge status={booking.status} />
            <InChulaChip outsideChula={booking.outsideChula} />
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{booking.purpose}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
        {booking.status === "COMPLETED" && (
          <Link
            href={`/requester/new?from=${booking.id}`}
            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {tr("rebook")}
          </Link>
        )}
        <Link
          href="/requester"
          className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          {tc("back")}
        </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("trip")}</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <Field label={t("destination")} value={`${booking.destination}, ${booking.province}`} />
          {booking.googleMapsUrl && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("mapsLink")}</div>
              <div className="mt-0.5">
                <a
                  href={booking.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {t("mapsLink")}
                </a>
              </div>
            </div>
          )}
          {booking.pickupLocation && (
            <Field label={tf("pickupLocation")} value={booking.pickupLocation} />
          )}
          {booking.waitingLocation && (
            <Field label={t("waitingLocation")} value={booking.waitingLocation} />
          )}
          <Field label={t("department")} value={booking.department.nameEn} />
          <Field label={t("start")} value={format(booking.startAt, "EEE d MMM yyyy HH:mm")} />
          <Field label={t("endBackAtFaculty")} value={format(booking.endAt, "EEE d MMM yyyy HH:mm")} />
          <Field
            label={tf("returnTripLabel")}
            value={booking.returnTrip ? tf("returnTripYes") : tf("returnTripNo")}
          />
          <Field label={t("passengers")} value={String(booking.passengerCount)} />
          {booking.maleCount != null && (
            <Field label={tf("maleCount")} value={String(booking.maleCount)} />
          )}
          {booking.femaleCount != null && (
            <Field label={tf("femaleCount")} value={String(booking.femaleCount)} />
          )}
          {booking.jobType === "SMUS" ? (
            <Field
              label={tf("externalVehicleCounts")}
              value={`${tf("externalBusCount")} ${booking.externalBusCount ?? 0} · ${tf("externalVanCount")} ${booking.externalVanCount ?? 0}`}
            />
          ) : (
            <Field label={tf("preferredVehicle")} value={vehicleTypeLabel(booking.preferredVehicleType)} />
          )}
          {!booking.waitAtDestination && (
            <Field label={t("flag")} value={t("notWaitingAtDestination")} />
          )}
          {booking.pickupReturnTime && (
            <Field label={t("pickupReturnTime")} value={booking.pickupReturnTime} />
          )}
          {booking.needsOutsourcing && (
            <Field label={t("flag")} value={t("flaggedForOutsourcing")} />
          )}
          {booking.isEmergency && (
            <Field label={t("flag")} value={tf("urgentBadge")} />
          )}
          {booking.estimatedDistance != null && (
            <Field label={t("estimatedDistance")} value={`${booking.estimatedDistance} km`} />
          )}
          {booking.outOfHoursReason && (
            <Field
              label={t("outOfHoursReason")}
              value={booking.outOfHoursReason}
              colSpan
            />
          )}
          {booking.passengerNotes && (
            <Field label={t("passengerNotes")} value={booking.passengerNotes} colSpan />
          )}
          {booking.attachmentUrl && (
            <div className="col-span-full">
              <p className="text-xs font-medium text-muted-foreground">{t("attachment")}</p>
              <a
                href={`/api/files/booking-attachment/${booking.id}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                {booking.attachmentFilename ?? t("attachment")}
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {(["APPROVED", "ASSIGNED", "COMPLETED", "OUTSOURCED"] as const).includes(
        booking.status as "APPROVED" | "ASSIGNED" | "COMPLETED" | "OUTSOURCED",
      ) && booking.ajarnName && (
        <Card>
          <CardHeader>
            <CardTitle>{t("ajarnSection")}</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
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

      {booking.vehicle && (
        <Card>
          <CardHeader>
            <CardTitle>{t("assignment")}</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <Field label={t("vehicle")} value={booking.vehicle.registrationNumber} />
            <Field
              label={t("driver")}
              value={driverLabel(booking.primaryDriver?.user)}
            />
            {booking.secondaryDriver && (
              <Field
                label={t("coDriver")}
                value={driverLabel(booking.secondaryDriver.user)}
              />
            )}
          </CardContent>
        </Card>
      )}

      {canEditTime && (
        <Card>
          <CardHeader>
            <CardTitle>{tr("changeTimeTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {booking.status === "ASSIGNED" && (
              <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                {tr("changeTimeAssignedWarning")}
              </p>
            )}
            <TimeChangeForm
              bookingId={booking.id}
              startAt={booking.startAt}
              endAt={booking.endAt}
              outOfHoursReason={booking.outOfHoursReason}
            />
          </CardContent>
        </Card>
      )}

      {canCancel && (
        <Card>
          <CardHeader>
            <CardTitle>{tr("cancelTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CancelForm bookingId={booking.id} />
          </CardContent>
        </Card>
      )}

      {booking.pdfUrl && (
        <Card>
          <CardHeader>
            <CardTitle>{t("approvalDocument")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={`/api/files/booking-pdf/${booking.id}`}
              className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
            >
              {t("downloadPdf")}
            </Link>
          </CardContent>
        </Card>
      )}

      {booking.status === "WAITLIST" && (
        <Card className="border-amber-300 ring-amber-300/50 dark:border-amber-900/40 dark:ring-amber-900/40">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-200">{t("waitlistTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-amber-800 dark:text-amber-300/90">
            {t("waitlistExplain")}
          </CardContent>
        </Card>
      )}

      {booking.status === "DENIED" && booking.denialReason && (
        <Card>
          <CardHeader>
            <CardTitle>{t("deniedTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{booking.denialReason}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("history")}</CardTitle>
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
                    {t("decidedBy", { name: log.actor.name ?? log.actor.email ?? "" })}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {needsEval && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle>{tr("tripEvaluation")}</CardTitle>
          </CardHeader>
          <CardContent>
            <EvaluationForm bookingId={booking.id} />
          </CardContent>
        </Card>
      )}

      {evaluationSubmitted && (
        <Card>
          <CardHeader>
            <CardTitle>{tr("tripEvaluation")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {tr("evaluationSubmittedNote")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Driver name + phone so the requester can call the day of the trip
// (แสดงชื่อ-เบอร์-ทะเบียน). Phone appended when on file.
function driverLabel(user: { name: string | null; email: string | null; phone: string | null } | null | undefined): string {
  if (!user) return "—";
  const name = user.name ?? user.email ?? "—";
  return user.phone ? `${name} · ${user.phone}` : name;
}
