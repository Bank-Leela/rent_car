import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { ApproveForm, ApproverDenyForm } from "@/components/forms/approve-form";

export default async function ApproverBookingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("APPROVER");
  const { id } = await params;
  const t = await getTranslations("bookingDetail");
  const ta = await getTranslations("approverActions");

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      requester: true,
      department: true,
      approvals: { orderBy: { createdAt: "asc" }, include: { approver: true } },
      auditLogs: { orderBy: { createdAt: "asc" }, include: { actor: true } },
    },
  });
  if (!booking) notFound();

  // Approval is fleet-section scoped, not dept-head scoped. requireRole above
  // already gated this; pull the signature so the form knows whether to warn.
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      signatureImageUrl: true,
      roles: { select: { role: true } },
      delegatedBy: { select: { roles: { select: { role: true } } } },
    },
  });
  const isApprover = me.roles.some((r) => r.role === "APPROVER");
  const isDelegateOfApprover = me.delegatedBy.some((u) =>
    u.roles.some((r) => r.role === "APPROVER"),
  );
  if (!isApprover && !isDelegateOfApprover) notFound();

  const isPending = booking.status === "PENDING_APPROVAL";

  const approvalStatusLabel = (s: "PENDING" | "APPROVED" | "DENIED") => {
    if (s === "APPROVED") return t("approvalStatusApproved");
    if (s === "DENIED") return t("approvalStatusDenied");
    return t("approvalStatusPending");
  };

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
          href="/approver"
          className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          {ta("backToInbox")}
        </Link>
      </div>

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
          {booking.passengerNotes && (
            <Field label={t("passengerNotes")} value={booking.passengerNotes} colSpan />
          )}
        </CardContent>
      </Card>

      {isPending && (
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

      {booking.approvals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("approvalHistory")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {booking.approvals.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span className="text-muted-foreground tabular-nums">
                    {a.decidedAt ? format(a.decidedAt, "d MMM HH:mm") : "—"}
                  </span>
                  <span>
                    <span className="font-medium">{approvalStatusLabel(a.status)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      {t("decidedBy", { name: a.approver.name ?? a.approver.email ?? "" })}
                    </span>
                    {a.comment && <span className="block text-muted-foreground">{a.comment}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
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
