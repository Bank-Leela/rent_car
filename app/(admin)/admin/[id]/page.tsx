import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { loadBookingDetailContext } from "@/lib/booking/detail-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { AssignForm, DenyForm } from "@/components/forms/assign-form";
import { ApproveForm, ApproverDenyForm } from "@/components/forms/approve-form";
import { OutsourceForm } from "@/components/forms/outsource-form";
import { MatchingButton, NeedsSecondaryDriverToggle } from "@/components/forms/matching-form";
import { CompleteTripForm } from "@/components/forms/complete-trip-form";
import { LessSubmitToggle } from "@/components/admin/less-submit-toggle";
import { EstimateDistanceButton } from "@/components/admin/estimate-distance-button";
import { isMapsConfigured } from "@/lib/maps/distance";
import { DetailField as Field } from "@/components/detail-field";

export default async function AdminBookingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAnyRole(["ADMIN"]);
  const { id } = await params;
  const t = await getTranslations("bookingDetail");
  const tless = await getTranslations("less");
  const mapsConfigured = isMapsConfigured();
  const tad = await getTranslations("adminDetail");
  const taf = await getTranslations("assignForm");
  const ta = await getTranslations("approverActions");
  // Reuse the booking-form field/value labels (pickup, vehicle type, gender
  // counts, etc.) so the detail page surfaces every input the requester filled.
  const tf = await getTranslations("bookingForm");
  const vehicleTypeLabel = (v: string) =>
    ({
      VAN: tf("preferredVehicleVan"),
      TRUCK_6_WHEEL: tf("preferredVehicleTruck6Wheel"),
      PICKUP: tf("preferredVehiclePickup"),
      SEDAN_DEAN: tf("preferredVehicleSedanDean"),
      BUS_OUTSOURCED: tf("preferredVehicleBusOutsourced"),
    })[v] ?? v;
  const isAdmin = session.user.roles.includes("ADMIN");

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      requester: true,
      department: true,
      vehicle: true,
      primaryDriver: { include: { user: true } },
      secondaryDriver: { include: { user: true } },
      auditLogs: { orderBy: { createdAt: "asc" }, include: { actor: true } },
      trip: true,
    },
  });
  if (!booking) notFound();

  const isPendingApproval = booking.status === "PENDING_APPROVAL";
  const isApproved = booking.status === "APPROVED";
  const isAssigned = booking.status === "ASSIGNED";
  // Admin's mutation forms only apply once the approver signs off.
  const showAssignForms = isAdmin && isApproved;
  const showApproverForms = isAdmin && isPendingApproval;
  const showCompleteForm = isAdmin && isAssigned;

  // Vehicle-conflict list, repeat-canceller warning, and (when a decision is
  // pending) the supply/risk decision context — see lib/booking/detail-context.
  const { vehicleOptions: vehicleData, cancellationWarning, cancellationCount, decisionContext } =
    await loadBookingDetailContext(booking, showApproverForms);
  const vehicleOptions = vehicleData.map((v) => ({
    id: v.id,
    label: `${v.registrationNumber} · ${v.type.toLowerCase()} · ${taf("seatSuffix", { capacity: v.capacity })}`,
    sublabel: v.isDutyVehicle ? taf("dutyVehicleTag") : undefined,
    disabled: v.conflict,
    conflict: v.conflict,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{booking.jobNumber}</span>
            <BookingStatusBadge status={booking.status} />
            {booking.isEmergency && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                {(await getTranslations("bookingForm"))("urgentBadge")}
              </span>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{booking.purpose}</h1>
          <p className="text-sm text-muted-foreground">
            {booking.requester.name ?? booking.requester.email} · {booking.department.nameTh}
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          {tad("backToQueue")}
        </Link>
      </div>

      {cancellationWarning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          {tad("cancellationWarning", { count: cancellationCount })}
        </div>
      )}

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
          <Field label={t("passengers")} value={String(booking.passengerCount)} />
          {booking.maleCount != null && (
            <Field label={tf("maleCount")} value={String(booking.maleCount)} />
          )}
          {booking.femaleCount != null && (
            <Field label={tf("femaleCount")} value={String(booking.femaleCount)} />
          )}
          <Field label={t("start")} value={format(booking.startAt, "EEE d MMM yyyy HH:mm")} />
          <Field label={t("endBackAtFaculty")} value={format(booking.endAt, "EEE d MMM yyyy HH:mm")} />
          <Field
            label={tf("returnTripLabel")}
            value={booking.returnTrip ? tf("returnTripYes") : tf("returnTripNo")}
          />
          {booking.jobType === "SMUS" ? (
            <Field
              label={tf("externalVehicleCounts")}
              value={`${tf("externalBusCount")} ${booking.externalBusCount ?? 0} · ${tf("externalVanCount")} ${booking.externalVanCount ?? 0}`}
            />
          ) : (
            <Field label={tf("preferredVehicle")} value={vehicleTypeLabel(booking.preferredVehicleType)} />
          )}
          {booking.estimatedDistance != null && (
            <Field label={t("estimatedDistance")} value={`${booking.estimatedDistance} km`} />
          )}
          {mapsConfigured && booking.jobType !== "SMUS" && (
            <div className="sm:col-span-2">
              <EstimateDistanceButton bookingId={booking.id} hasDistance={booking.estimatedDistance != null} />
            </div>
          )}
          {booking.needsOutsourcing && <Field label={t("flag")} value={t("flaggedForOutsourcing")} />}
          {!booking.waitAtDestination && (
            <Field label={t("flag")} value={t("notWaitingAtDestination")} />
          )}
          {booking.pickupReturnTime && (
            <Field label={t("pickupReturnTime")} value={booking.pickupReturnTime} />
          )}
          {booking.waitingLocation && (
            <Field label={t("waitingLocation")} value={booking.waitingLocation} />
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
            <CardTitle>{t("currentAssignment")}</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <Field label={t("vehicle")} value={booking.vehicle.registrationNumber} />
            <Field
              label={t("driver")}
              value={booking.primaryDriver?.user.name ?? booking.primaryDriver?.user.email ?? "—"}
            />
            {booking.secondaryDriver && (
              <Field
                label={t("coDriver")}
                value={booking.secondaryDriver.user.name ?? booking.secondaryDriver.user.email!}
              />
            )}
          </CardContent>
        </Card>
      )}

      {booking.trip && (
        <Card>
          <CardHeader>
            <CardTitle>{t("tripRecordTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <Field label={t("tripStarted")} value={format(booking.trip.startedAt, "EEE d MMM HH:mm")} />
            <Field
              label={t("tripEnded")}
              value={
                booking.trip.endedAt
                  ? format(booking.trip.endedAt, "EEE d MMM HH:mm")
                  : t("tripInProgress")
              }
            />
            <Field
              label={t("tripStartMileage")}
              value={`${booking.trip.startMileage.toLocaleString()} km`}
            />
            <Field
              label={t("tripEndMileage")}
              value={booking.trip.endMileage != null ? `${booking.trip.endMileage.toLocaleString()} km` : "—"}
            />
            <Field
              label={t("tripDistance")}
              value={booking.trip.distanceKm != null ? `${booking.trip.distanceKm} km` : "—"}
            />
            <Field
              label={t("tripFuel")}
              value={booking.trip.fuelCost != null ? `฿${booking.trip.fuelCost.toString()}` : "—"}
            />
            <Field
              label={t("tripTollway")}
              value={booking.trip.tollwayCost != null ? `฿${booking.trip.tollwayCost.toString()}` : "—"}
            />
            {booking.trip.usedExpressway && (
              <Field label={t("tripExpressway")} value={t("tripExpresswayUsed")} />
            )}
            {booking.trip.driverNotes && (
              <Field label={t("tripDriverNotes")} value={booking.trip.driverNotes} colSpan />
            )}
          </CardContent>
        </Card>
      )}

      {booking.pdfUrl && (
        <Card>
          <CardHeader>
            <CardTitle>{t("approvalDocument")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link
              href={`/api/files/booking-pdf/${booking.id}`}
              className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
            >
              {t("downloadPdf")}
            </Link>
            {/* Manual LESS Paper submission: download above, upload to LESS, mark here. */}
            <div className="border-t pt-3">
              <p className="mb-2 text-xs text-muted-foreground">{tless("hint")}</p>
              <LessSubmitToggle
                bookingId={booking.id}
                submittedLabel={booking.lessSubmittedAt ? format(booking.lessSubmittedAt, "d MMM yyyy HH:mm") : null}
              />
            </div>
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

      {decisionContext && (
        <Card>
          <CardHeader>
            <CardTitle>{tad("decisionContextTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{tad("dayLoad")}</span>
                <span className="font-medium tabular-nums">
                  {decisionContext.dayUsed}/{decisionContext.dayCapacity}
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${
                    decisionContext.dayCapacity > 0 && decisionContext.dayUsed >= decisionContext.dayCapacity
                      ? "bg-rose-500"
                      : decisionContext.dayCapacity > 0 &&
                          decisionContext.dayUsed >= decisionContext.dayCapacity * 0.8
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                  style={{
                    width: `${
                      decisionContext.dayCapacity > 0
                        ? Math.min(100, Math.round((decisionContext.dayUsed / decisionContext.dayCapacity) * 100))
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">{tad("freeCarsAtTime")}</span>
              <span className="text-right">
                <span className="font-medium">
                  {tad("freeCarsCount", {
                    free: decisionContext.freeCars.length,
                    total: decisionContext.totalCars,
                  })}
                </span>
                {decisionContext.freeCars.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    {decisionContext.freeCars.join(", ")}
                  </span>
                )}
              </span>
            </div>

            {decisionContext.flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {decisionContext.flags.map((f) => (
                  <span
                    key={f}
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                      f === "emergency"
                        ? "bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-300"
                        : "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
                    }`}
                  >
                    {f === "emergency"
                      ? tad("flagEmergency")
                      : f === "outOfHours"
                        ? tad("flagOutOfHours")
                        : f === "shortLead"
                          ? tad("flagShortLead")
                          : tad("flagTwoDrivers")}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showApproverForms && (
        <div className="grid sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{ta("approveTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ApproveForm
                bookingId={booking.id}
                returnTrip={booking.returnTrip}
                startAt={format(booking.startAt, "yyyy-MM-dd'T'HH:mm")}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{ta("denyTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ApproverDenyForm bookingId={booking.id} />
            </CardContent>
          </Card>
        </div>
      )}

      {showAssignForms && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{tad("allocateVehicle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <AssignForm bookingId={booking.id} vehicleOptions={vehicleOptions} />
            </CardContent>
          </Card>

          {booking.outOfProvince && !booking.primaryDriverId && (
            <Card>
              <CardHeader>
                <CardTitle>{tad("secondaryDriverTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <NeedsSecondaryDriverToggle
                  bookingId={booking.id}
                  defaultChecked={booking.needsSecondaryDriver}
                />
              </CardContent>
            </Card>
          )}

          {!booking.primaryDriverId && (
            <Card>
              <CardHeader>
                <CardTitle>{tad("matchingTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <MatchingButton bookingId={booking.id} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{tad("denyTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DenyForm bookingId={booking.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tad("outsourceTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {booking.outsourceQuoteUrl && (
                <Link
                  href={`/api/files/outsource-quote/${booking.id}`}
                  className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
                >
                  {t("downloadQuote")}
                </Link>
              )}
              <OutsourceForm bookingId={booking.id} />
            </CardContent>
          </Card>
        </>
      )}

      {showCompleteForm && (
        <Card>
          <CardHeader>
            <CardTitle>{tad("completeTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CompleteTripForm bookingId={booking.id} />
          </CardContent>
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
    </div>
  );
}
