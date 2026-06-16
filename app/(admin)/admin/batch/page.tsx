import Link from "next/link";
import { format, startOfDay, addDays } from "date-fns";
import { getTranslations, getLocale } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { BatchRunForm } from "@/components/forms/batch-run-form";
import { ReclaimDecisionForm } from "@/components/forms/reclaim-decision-form";
import { AssignRecoButton } from "@/components/forms/assign-reco-button";
import { recommendForBookings } from "@/lib/booking/placement-reco-data";

const OVERFLOW_TONE: Record<string, string> = {
  NO_PRIMARY_DRIVER:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200",
  NO_SECONDARY_DRIVER:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200",
  NO_SLOT:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200",
  NEEDS_WERN_RECLAIM_DECISION:
    "border-destructive/40 bg-destructive/10 text-destructive",
};

type DetailBooking = {
  ajarnName: string;
  ajarnPhone: string;
  ajarnEmail: string;
  destination: string;
  province: string;
  outOfProvince: boolean;
  passengerCount: number;
  maleCount: number | null;
  femaleCount: number | null;
  pickupLocation: string | null;
  estimatedDistance: number | null;
  passengerNotes: string | null;
  isEmergency: boolean;
  outsideChula: boolean;
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-1">
      <dt className="shrink-0 font-medium text-foreground/70">{label}:</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}

// Shows the professor (ajarn) plus every captured input for one booking.
function BookingInputs({ b, labels }: { b: DetailBooking; labels: Record<string, string> }) {
  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
          {labels.ajarn}: {b.ajarnName}
        </span>
        {b.isEmergency && (
          <span className="rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
            {labels.emergency}
          </span>
        )}
        {b.outsideChula && (
          <span className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
            {labels.outsideChula}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
        <Field label={labels.phone} value={b.ajarnPhone} />
        <Field label={labels.email} value={b.ajarnEmail} />
        <Field
          label={labels.destination}
          value={`${b.destination} (${b.province})${b.outOfProvince ? " · ตจว" : ""}`}
        />
        <Field
          label={labels.passengers}
          value={`${b.passengerCount} — ♂${b.maleCount ?? 0} ♀${b.femaleCount ?? 0}`}
        />
        <Field label={labels.pickup} value={b.pickupLocation} />
        <Field label={labels.distance} value={b.estimatedDistance != null ? `${b.estimatedDistance} km` : null} />
        <Field label={labels.notes} value={b.passengerNotes} />
      </dl>
    </div>
  );
}

export default async function AdminBatchPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole("ADMIN");
  const t = await getTranslations("adminBatch");
  const tf = await getTranslations("bookingForm");
  const L = {
    ajarn: tf("ajarnName"),
    phone: tf("ajarnPhone"),
    email: tf("ajarnEmail"),
    destination: tf("destination"),
    passengers: tf("passengerCount"),
    pickup: tf("pickupLocation"),
    distance: tf("estimatedDistance"),
    notes: tf("passengerNotes"),
    emergency: tf("emergencyLabel"),
    outsideChula: tf("outsideChulaLabel"),
  };
  const { date: dateParam } = await searchParams;

  const todayIso = format(startOfDay(new Date()), "yyyy-MM-dd");
  const targetDate = dateParam ?? todayIso;
  const dayStart = new Date(`${targetDate}T00:00:00`);
  const dayEnd = addDays(dayStart, 1);

  const [pending, assigned, overflows, onCallShift] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: "APPROVED",
        primaryDriverId: null,
        startAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { createdAt: "asc" },
      include: { requester: true, department: true },
    }),
    prisma.booking.findMany({
      where: {
        status: "ASSIGNED",
        startAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { startAt: "asc" },
      include: {
        primaryDriver: { include: { user: true } },
        secondaryDriver: { include: { user: true } },
        vehicle: true,
      },
    }),
    prisma.booking.findMany({
      where: {
        overflowReason: { not: null },
        startAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { createdAt: "asc" },
      include: { requester: true, department: true },
    }),
    prisma.onCallShift.findUnique({
      where: { date: dayStart },
      include: { driver: { include: { user: true } } },
    }),
  ]);

  // Recommendation for each leftover the solver couldn't place (P'Top override).
  const isThai = (await getLocale()).toLowerCase().startsWith("th");
  const recos = await recommendForBookings(dayStart, overflows, isThai);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("runTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <BatchRunForm defaultDate={targetDate} />
          <p className="text-xs text-muted-foreground">
            {onCallShift
              ? t("dutyDriverNote", {
                  name: onCallShift.driver.user.name ?? onCallShift.driver.user.email ?? "",
                })
              : t("noDutyDriverNote")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("pendingTitle", { count: pending.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("pendingEmpty")}</p>
          ) : (
            <ul className="divide-y">
              {pending.map((b) => (
                <li key={b.id} className="py-3 text-sm">
                  <Link href={`/admin/${b.id}`} className="font-medium hover:underline">
                    {b.jobNumber}
                  </Link>
                  <span className="mx-2 text-muted-foreground">{b.purpose}</span>
                  <span className="text-xs text-muted-foreground">
                    {format(b.startAt, "HH:mm")} → {format(b.endAt, "HH:mm")} · {b.jobType}
                    {b.outOfProvince ? " · ตจว" : ""}
                  </span>
                  <BookingInputs b={b} labels={L} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("overflowTitle", { count: overflows.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {overflows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("overflowEmpty")}</p>
          ) : (
            <ul className="space-y-3">
              {overflows.map((b) => {
                const reason = b.overflowReason ?? "NO_PRIMARY_DRIVER";
                return (
                  <li
                    key={b.id}
                    className={`rounded-md border p-3 text-sm space-y-2 ${OVERFLOW_TONE[reason] ?? ""}`}
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <Link href={`/admin/${b.id}`} className="font-medium hover:underline">
                          {b.jobNumber}
                        </Link>
                        <span className="ml-2">{b.purpose}</span>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-wide">
                        {reason}
                      </span>
                    </div>
                    <div className="text-xs opacity-80">
                      {format(b.startAt, "HH:mm")} → {format(b.endAt, "HH:mm")} ·{" "}
                      {b.requester.name ?? b.requester.email} · {b.department.nameEn}
                    </div>
                    <BookingInputs b={b} labels={L} />
                    {(() => {
                      const r = recos.get(b.id);
                      if (!r || r.kind === "none") {
                        return <div className="text-xs text-muted-foreground">💡 {t("recoNone")}</div>;
                      }
                      const car = r.registrationNumber ?? "";
                      const name = r.driverName ?? "";
                      const msg = r.kind === "reclaim" ? t("recoReclaim", { car, name }) : t("recoFit", { car, name });
                      return (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span>💡 {msg}</span>
                          <AssignRecoButton bookingId={b.id} vehicleId={r.vehicleId} label={t("assignReco")} />
                        </div>
                      );
                    })()}
                    {reason === "NEEDS_WERN_RECLAIM_DECISION" && (
                      <ReclaimDecisionForm bookingId={b.id} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("assignedTitle", { count: assigned.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {assigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("assignedEmpty")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {assigned.map((b) => (
                <li key={b.id} className="py-3 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/${b.id}`} className="font-medium hover:underline">
                      {b.jobNumber}
                    </Link>
                    <span className="ml-2">{b.purpose}</span>
                    <div className="text-xs text-muted-foreground">
                      {format(b.startAt, "HH:mm")} → {format(b.endAt, "HH:mm")} · {b.jobType}
                    </div>
                    <BookingInputs b={b} labels={L} />
                  </div>
                  <div className="text-xs">
                    {b.vehicle && <div>{b.vehicle.registrationNumber}</div>}
                    {b.primaryDriver && (
                      <div>
                        {b.primaryDriver.user.name ?? b.primaryDriver.user.email}
                        {b.secondaryDriver && (
                          <> · {b.secondaryDriver.user.name ?? b.secondaryDriver.user.email}</>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
