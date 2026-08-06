import Link from "next/link";
import { format } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { IdCard, CalendarClock } from "lucide-react";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { licenseStatus, retirementStatus } from "@/lib/admin/roster-alerts";
import {
  approvalFunnel,
  driverUtilisation,
  rangeFromQuery,
  repeatCancellers,
  requestVolumeByDepartment,
  requestVolumeByMonth,
  vehicleUtilisation,
} from "@/lib/reporting/metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VolumeBarChart, FunnelPieChart } from "@/components/dashboard/charts";
import { RangeFilter } from "@/components/dashboard/range-filter";
import { AnimatedNumber } from "@/components/animated-number";

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireAnyRole(["ADMIN"]);
  const t = await getTranslations("dashboard");
  const tv = await getTranslations("fleet");
  const locale = await getLocale();
  const qs = await searchParams;
  const range = rangeFromQuery(qs);
  const exportQs = new URLSearchParams({
    from: format(range.from, "yyyy-MM-dd"),
    to: format(range.to, "yyyy-MM-dd"),
  }).toString();

  const [funnel, byMonth, byDept, vehicle, driver, cancellations, activeDrivers] = await Promise.all([
    approvalFunnel(range),
    requestVolumeByMonth(range, undefined, locale),
    requestVolumeByDepartment(range),
    vehicleUtilisation(range),
    driverUtilisation(range),
    repeatCancellers(range),
    prisma.driver.findMany({
      where: { isActive: true },
      select: {
        id: true,
        licenseExpiresAt: true,
        retirementYear: true,
        user: { select: { name: true, thaiName: true } },
      },
    }),
  ]);

  // Roster alerts (license expiry / upcoming retirement) from the driver sheet
  // data — same windows as the /admin/drivers badges.
  const now = new Date();
  const rosterAlerts = activeDrivers
    .map((d) => ({
      id: d.id,
      name: d.user.name ?? d.user.thaiName ?? d.id,
      license: licenseStatus(d.licenseExpiresAt, now),
      licenseDate: d.licenseExpiresAt,
      retirement: retirementStatus(d.retirementYear, now),
      retirementYear: d.retirementYear,
    }))
    .filter((d) => d.license === "expiring" || d.license === "expired" || d.retirement === "soon" || d.retirement === "due");

  const pctText = (n: number) => {
    if (funnel.total === 0) return t("ofTotal", { pct: "0%" });
    return t("ofTotal", { pct: `${Math.round((n / funnel.total) * 100)}%` });
  };

  return (
    <div className="space-y-6 print:space-y-3 mesh-bg animate-fade-up">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold display-heading">{t("title")}</h1>
          <p className="text-muted-foreground mt-1">
            {format(range.from, "d MMM yyyy")} – {format(range.to, "d MMM yyyy")}
          </p>
        </div>
        <div className="flex items-end gap-3">
          <RangeFilter from={range.from} to={range.to} />
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 print:grid-cols-3 stagger-children">
        <KpiCard label={t("totalRequests")} value={funnel.total} />
        <KpiCard label={t("approved")} value={funnel.approved} sub={pctText(funnel.approved)} />
        <KpiCard label={t("cancelled")} value={funnel.cancelled} sub={pctText(funnel.cancelled)} />
      </div>

      {rosterAlerts.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-900/40">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-200">{t("rosterAlertsTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {rosterAlerts.map((d) => (
                <li key={d.id}>
                  <Link href={`/admin/drivers/${d.id}`} className="group inline-flex flex-wrap items-center gap-2 hover:underline">
                    <span className="font-medium">{d.name}</span>
                    {(d.license === "expiring" || d.license === "expired") && d.licenseDate && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          d.license === "expired"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}
                      >
                        <IdCard className="h-3 w-3" aria-hidden />
                        {d.license === "expired"
                          ? t("rosterLicenseExpired", { date: format(d.licenseDate, "d MMM yyyy") })
                          : t("rosterLicenseExpiring", { date: format(d.licenseDate, "d MMM yyyy") })}
                      </span>
                    )}
                    {(d.retirement === "soon" || d.retirement === "due") && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          d.retirement === "due"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}
                      >
                        <CalendarClock className="h-3 w-3" aria-hidden />
                        {t("rosterRetirement", { year: d.retirementYear ?? 0 })}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("requestVolumeByMonth")}</CardTitle>
              <Link href={`/api/reports/csv/volume?${exportQs}`} className="text-xs underline print:hidden">{t("csv")}</Link>
            </div>
          </CardHeader>
          <CardContent>
            {byMonth.length > 0 ? <VolumeBarChart data={byMonth} /> : <Empty label={t("noData")} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("approvalFunnel")}</CardTitle>
              <Link href={`/api/reports/csv/funnel?${exportQs}`} className="text-xs underline print:hidden">{t("csv")}</Link>
            </div>
          </CardHeader>
          <CardContent>
            <FunnelPieChart
              data={[
                { label: t("funnelApproved"), value: funnel.approved },
                { label: t("funnelDenied"), value: funnel.denied },
                { label: t("funnelCancelled"), value: funnel.cancelled },
                { label: t("funnelOutsourced"), value: funnel.outsourced },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("requestVolumeByDept")}</CardTitle>
            <Link href={`/api/reports/csv/department?${exportQs}`} className="text-xs underline print:hidden">{t("csv")}</Link>
          </div>
        </CardHeader>
        <CardContent>
          {byDept.length === 0 ? <Empty label={t("noData")} /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("deptColumn")}</TableHead>
                  <TableHead className="text-right">{t("requestsColumn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byDept.map((d) => (
                  <TableRow key={d.department}>
                    <TableCell>{d.department}</TableCell>
                    <TableCell className="text-right">{d.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("vehicleUtilisation")}</CardTitle>
            <Link href={`/api/reports/csv/vehicles?${exportQs}`} className="text-xs underline print:hidden">{t("csv")}</Link>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("vehicleColumn")}</TableHead>
                <TableHead className="text-right">{t("tripsColumn")}</TableHead>
                <TableHead className="text-right">{t("hoursColumn")}</TableHead>
                <TableHead className="text-right">{t("kmColumn")}</TableHead>
                <TableHead className="text-right">{t("fuelColumn")}</TableHead>
                <TableHead className="text-right">{t("tollwayColumn")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicle.map((v) => (
                <TableRow key={v.registrationNumber}>
                  <TableCell>{`${tv(`type_${v.type}`)} · ${v.registrationNumber}`}</TableCell>
                  <TableCell className="text-right">{v.trips}</TableCell>
                  <TableCell className="text-right">{v.hours.toFixed(1)}</TableCell>
                  <TableCell className="text-right">{v.km}</TableCell>
                  <TableCell className="text-right">{v.fuel.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{v.tollway.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("driverUtilisation")}</CardTitle>
            <Link href={`/api/reports/csv/drivers?${exportQs}`} className="text-xs underline print:hidden">{t("csv")}</Link>
          </div>
        </CardHeader>
        <CardContent>
          {driver.length === 0 ? <Empty label={t("noData")} /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("driverColumn")}</TableHead>
                  <TableHead className="text-right">{t("tripsColumn")}</TableHead>
                  <TableHead className="text-right">{t("hoursColumn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {driver.map((d) => (
                  <TableRow key={d.name}>
                    <TableCell>{d.name}</TableCell>
                    <TableCell className="text-right">{d.trips}</TableCell>
                    <TableCell className="text-right">{d.hours.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("repeatCancellers")}</CardTitle>
            <Link href={`/api/reports/csv/cancellations?${exportQs}`} className="text-xs underline print:hidden">{t("csv")}</Link>
          </div>
        </CardHeader>
        <CardContent>
          {cancellations.length === 0 ? <Empty label={t("noData")} /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("userColumn")}</TableHead>
                  <TableHead className="text-right">{t("cancellationsColumn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cancellations.map((c) => (
                  <TableRow key={c.userId} className={c.cancellations >= 3 ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="text-right">{c.cancellations}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground print:hidden">
        {t("printTip")}
      </p>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card className="card-lift">
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-3xl font-semibold mt-1 display-heading">
          <AnimatedNumber value={value} />
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}
