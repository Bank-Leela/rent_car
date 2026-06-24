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
import { Field } from "@/components/detail-field";

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
  const canEditTime = booking.status === "PENDING_APPROVAL";
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
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{booking.purpose}</h1>
        </div>
        <Link
          href="/requester"
          className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          {tc("back")}
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("trip")}</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <Field label={t("destination")} value={`${booking.destination}, ${booking.province}`} />
          <Field label={t("department")} value={booking.department.nameEn} />
          <Field label={t("start")} value={format(booking.startAt, "EEE d MMM yyyy HH:mm")} />
          <Field label={t("endBackAtFaculty")} value={format(booking.endAt, "EEE d MMM yyyy HH:mm")} />
          <Field label={t("passengers")} value={String(booking.passengerCount)} />
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

      {canEditTime && (
        <Card>
          <CardHeader>
            <CardTitle>{tr("changeTimeTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
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
