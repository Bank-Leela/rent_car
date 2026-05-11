import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import {
  approvalFunnel,
  rangeFromQuery,
  requestVolumeByWeek,
  vehicleUtilisation,
} from "@/lib/reporting/metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VolumeBarChart, FunnelPieChart } from "@/components/dashboard/charts";
import { RangeFilter } from "@/components/dashboard/range-filter";

export default async function DepartmentUsage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requireRole("APPROVER");
  const t = await getTranslations("deptUsage");
  const td = await getTranslations("dashboard");
  const qs = await searchParams;
  const range = rangeFromQuery(qs);

  const myDepts = await prisma.department.findMany({
    where: {
      OR: [
        { headUserId: session.user.id },
        { head: { delegatedToUserId: session.user.id } },
      ],
    },
  });

  if (myDepts.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("notHead")}</p>;
  }

  const dept = myDepts[0];
  const [funnel, byWeek, vehicle] = await Promise.all([
    approvalFunnel(range, dept.id),
    requestVolumeByWeek(range, dept.id),
    vehicleUtilisation(range),
  ]);

  const deptVehicleIds = await prisma.booking.findMany({
    where: { departmentId: dept.id, vehicleId: { not: null } },
    select: { vehicleId: true },
    distinct: ["vehicleId"],
  });
  const deptVehicleRegs = new Set(
    (
      await prisma.vehicle.findMany({
        where: { id: { in: deptVehicleIds.map((v) => v.vehicleId!).filter(Boolean) } },
        select: { registrationNumber: true },
      })
    ).map((v) => v.registrationNumber),
  );
  const deptVehicle = vehicle.filter((v) => deptVehicleRegs.has(v.registrationNumber));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("titleSuffix", { name: dept.nameEn })}
          </h1>
          <p className="text-muted-foreground">
            {format(range.from, "d MMM yyyy")} – {format(range.to, "d MMM yyyy")}
          </p>
        </div>
        <RangeFilter from={range.from} to={range.to} />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <KpiCard label={td("totalRequests")} value={funnel.total} />
        <KpiCard label={td("approved")} value={funnel.approved} />
        <KpiCard label={td("cancelled")} value={funnel.cancelled} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>{t("volumeByWeek")}</CardTitle></CardHeader>
          <CardContent>
            {byWeek.length > 0 ? <VolumeBarChart data={byWeek} /> : <Empty label={td("noData")} />}
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
          {deptVehicle.length === 0 ? <Empty label={td("noData")} /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2">{td("vehicleColumn")}</th>
                  <th className="text-right py-2">{td("tripsColumn")}</th>
                  <th className="text-right py-2">{td("kmColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {deptVehicle.map((v) => (
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

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-3xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}
