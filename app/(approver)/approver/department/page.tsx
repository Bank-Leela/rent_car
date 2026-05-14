import { format } from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import {
  approvalFunnel,
  rangeFromQuery,
  requestVolumeByMonth,
  vehicleUtilisation,
} from "@/lib/reporting/metrics";
import { CheckCircle2, FileText, XCircle, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VolumeBarChart, FunnelPieChart } from "@/components/dashboard/charts";
import { RangeFilter } from "@/components/dashboard/range-filter";

type KpiTone = "neutral" | "approved" | "cancelled";
const KPI_TONE: Record<KpiTone, { ring: string; iconBg: string; iconFg: string; value: string }> = {
  neutral: {
    ring: "ring-indigo-200/70 dark:ring-indigo-900/40",
    iconBg: "bg-indigo-100 dark:bg-indigo-950/40",
    iconFg: "text-indigo-700 dark:text-indigo-300",
    value: "text-indigo-900 dark:text-indigo-100",
  },
  approved: {
    ring: "ring-emerald-200/70 dark:ring-emerald-900/40",
    iconBg: "bg-emerald-100 dark:bg-emerald-950/40",
    iconFg: "text-emerald-700 dark:text-emerald-300",
    value: "text-emerald-900 dark:text-emerald-100",
  },
  cancelled: {
    ring: "ring-rose-200/70 dark:ring-rose-900/40",
    iconBg: "bg-rose-100 dark:bg-rose-950/40",
    iconFg: "text-rose-700 dark:text-rose-300",
    value: "text-rose-900 dark:text-rose-100",
  },
};

export default async function DepartmentUsage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole("APPROVER");
  const t = await getTranslations("deptUsage");
  const td = await getTranslations("dashboard");
  const locale = await getLocale();
  const qs = await searchParams;
  const range = rangeFromQuery(qs);

  // Fleet-section view: aggregate across every department the fleet serves.
  const [funnel, byMonth, vehicle] = await Promise.all([
    approvalFunnel(range),
    requestVolumeByMonth(range, undefined, locale),
    vehicleUtilisation(range),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("titleAll")}</h1>
          <p className="text-muted-foreground">
            {format(range.from, "d MMM yyyy")} – {format(range.to, "d MMM yyyy")}
          </p>
        </div>
        <RangeFilter from={range.from} to={range.to} />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <KpiCard label={td("totalRequests")} value={funnel.total} icon={FileText} tone="neutral" />
        <KpiCard label={td("approved")} value={funnel.approved} icon={CheckCircle2} tone="approved" />
        <KpiCard label={td("cancelled")} value={funnel.cancelled} icon={XCircle} tone="cancelled" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>{t("volumeByMonth")}</CardTitle></CardHeader>
          <CardContent>
            {byMonth.length > 0 ? <VolumeBarChart data={byMonth} /> : <Empty label={td("noData")} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("funnel")}</CardTitle></CardHeader>
          <CardContent>
            <FunnelPieChart
              data={[
                { label: td("funnelApproved"), value: funnel.approved },
                { label: td("funnelDenied"), value: funnel.denied },
                { label: td("funnelCancelled"), value: funnel.cancelled },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("vehiclesUsed")}</CardTitle></CardHeader>
        <CardContent>
          {vehicle.length === 0 ? <Empty label={td("noData")} /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2">{td("vehicleColumn")}</th>
                  <th className="text-right py-2">{td("tripsColumn")}</th>
                  <th className="text-right py-2">{td("kmColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {vehicle.map((v) => (
                  <tr key={v.registrationNumber} className="border-t">
                    <td className="py-2">{v.registrationNumber}</td>
                    <td className="text-right py-2">{v.trips}</td>
                    <td className="text-right py-2">{v.km}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: KpiTone;
}) {
  const t = KPI_TONE[tone];
  return (
    <Card className={`ring-1 ring-inset ${t.ring}`}>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={`text-3xl font-semibold leading-tight mt-0.5 tabular-nums ${t.value}`}>{value}</div>
          </div>
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${t.iconBg} ${t.iconFg}`}>
            <Icon className="h-5 w-5" aria-hidden />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}
