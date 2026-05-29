import Link from "next/link";
import { format, startOfDay, addDays } from "date-fns";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { BatchRunForm } from "@/components/forms/batch-run-form";
import { ReclaimDecisionForm } from "@/components/forms/reclaim-decision-form";

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

export default async function AdminBatchPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole("ADMIN");
  const t = await getTranslations("adminBatch");
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
                  <div>
                    <Link href={`/admin/${b.id}`} className="font-medium hover:underline">
                      {b.jobNumber}
                    </Link>
                    <span className="ml-2">{b.purpose}</span>
                    <div className="text-xs text-muted-foreground">
                      {format(b.startAt, "HH:mm")} → {format(b.endAt, "HH:mm")} · {b.jobType}
                    </div>
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
