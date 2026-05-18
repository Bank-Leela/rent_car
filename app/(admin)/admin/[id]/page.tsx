import { notFound } from "next/navigation";
import Link from "next/link";
import { format, subDays } from "date-fns";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { findBufferConflicts, shouldWarnAboutCancellations } from "@/lib/booking/rules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { AssignForm, DenyForm } from "@/components/forms/assign-form";
import { ApproveForm, ApproverDenyForm } from "@/components/forms/approve-form";
import { OutsourceForm } from "@/components/forms/outsource-form";

export default async function AdminBookingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAnyRole(["ADMIN", "APPROVER"]);
  const { id } = await params;
  const t = await getTranslations("bookingDetail");
  const tad = await getTranslations("adminDetail");
  const taf = await getTranslations("assignForm");
  const ta = await getTranslations("approverActions");
  const isAdmin = session.user.roles.includes("ADMIN");
  const isApprover = session.user.roles.includes("APPROVER");

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

  // CR-02: admin only allocates a vehicle. Driver pool is no longer loaded
  // here — drivers self-claim on the schedule board.
  const [vehicles, otherBookingsByVehicle, recentCancellations] = await Promise.all([
    prisma.vehicle.findMany({ where: { isActive: true }, orderBy: { registrationNumber: "asc" } }),
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
      label: `${v.registrationNumber} · ${v.type.toLowerCase()} · ${taf("seatSuffix", { capacity: v.capacity })}`,
      sublabel: v.isReserved ? taf("reservedTag") : undefined,
      disabled: conflictCount > 0,
      conflict: conflictCount > 0,
    };
  });

  const isPendingApproval = booking.status === "PENDING_APPROVAL";
  const isApproved = booking.status === "APPROVED";
  // Admin's mutation forms only apply once the approver signs off.
  const showAssignForms = isAdmin && isApproved;
  const showApproverForms = isApprover && isPendingApproval;
  const cancellationWarning = shouldWarnAboutCancellations(recentCancellations);

  // Approver needs their stored signature to approve; load it only when needed.
  const me = showApproverForms
    ? await prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { signatureImageUrl: true },
      })
    : null;

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
          {tad("backToQueue")}
        </Link>
      </div>

      {cancellationWarning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          {tad("cancellationWarning", { count: recentCancellations })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("trip")}</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <Field label={t("destination")} value={`${booking.destination}, ${booking.province}`} />
          <Field label={t("passengers")} value={String(booking.passengerCount)} />
          <Field label={t("start")} value={format(booking.startAt, "EEE d MMM yyyy HH:mm")} />
          <Field label={t("endBackAtFaculty")} value={format(booking.endAt, "EEE d MMM yyyy HH:mm")} />
          {booking.estimatedDistance != null && (
            <Field label={t("estimatedDistance")} value={`${booking.estimatedDistance} km`} />
          )}
          {booking.needsOutsourcing && <Field label={t("flag")} value={t("flaggedForOutsourcing")} />}
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

      {(["APPROVED", "ASSIGNED", "COMPLETED"] as const).includes(
        booking.status as "APPROVED" | "ASSIGNED" | "COMPLETED",
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

      {booking.status === "DENIED" && booking.denialReason && (
        <Card>
          <CardHeader>
            <CardTitle>{t("deniedTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{booking.denialReason}</CardContent>
        </Card>
      )}

      {showApproverForms && me && (
        <div className="grid sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{ta("approveTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ApproveForm bookingId={booking.id} hasSignature={!!me.signatureImageUrl} />
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
            <CardContent>
              <OutsourceForm bookingId={booking.id} />
            </CardContent>
          </Card>
        </>
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

function Field({ label, value, colSpan }: { label: string; value: string; colSpan?: boolean }) {
  return (
    <div className={colSpan ? "sm:col-span-2" : ""}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
