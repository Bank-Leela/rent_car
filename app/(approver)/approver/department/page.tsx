import { format } from "date-fns";
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
    return <p className="text-sm text-muted-foreground">You don&rsquo;t head a department yet.</p>;
  }

  // Phase 4 keeps this single-department; multi-dept heads see the first.
  const dept = myDepts[0];
  const [funnel, byWeek, vehicle] = await Promise.all([
    approvalFunnel(range, dept.id),
    requestVolumeByWeek(range, dept.id),
    vehicleUtilisation(range), // utilisation is fleet-wide; we don't slice by dept
  ]);

  // Filter vehicle utilisation rows down to those used by this dept's bookings.
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
          <h1 className="text-2xl font-semibold tracking-tight">{dept.nameEn} usage</h1>
          <p className="text-muted-foreground">
            {format(range.from, "d MMM yyyy")} – {format(range.to, "d MMM yyyy")}
          </p>
        </div>
        <RangeFilter from={range.from} to={range.to} />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <KpiCard label="Total requests" value={funnel.total} />
        <KpiCard label="Approved" value={funnel.approved} />
        <KpiCard label="Cancelled" value={funnel.cancelled} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Volume by week</CardTitle></CardHeader>
          <CardContent>
            {byWeek.length > 0 ? <VolumeBarChart data={byWeek} /> : <Empty />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Funnel</CardTitle></CardHeader>
          <CardContent>
            <FunnelPieChart
              data={[
                { label: "Approved", value: funnel.approved },
                { label: "Denied", value: funnel.denied },
                { label: "Cancelled", value: funnel.cancelled },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Vehicles used by your department</CardTitle></CardHeader>
        <CardContent>
          {deptVehicle.length === 0 ? <Empty /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2">Vehicle</th>
                  <th className="text-right py-2">Trips</th>
                  <th className="text-right py-2">Km</th>
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

function Empty() {
  return <p className="py-8 text-center text-sm text-muted-foreground">No data in range.</p>;
}
