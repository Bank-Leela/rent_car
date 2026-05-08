import Link from "next/link";
import { format } from "date-fns";
import { requireRole } from "@/lib/auth-helpers";
import {
  approvalFunnel,
  driverUtilisation,
  rangeFromQuery,
  repeatCancellers,
  requestVolumeByDepartment,
  requestVolumeByWeek,
  vehicleUtilisation,
} from "@/lib/reporting/metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VolumeBarChart, FunnelPieChart } from "@/components/dashboard/charts";
import { RangeFilter } from "@/components/dashboard/range-filter";

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole("ADMIN");
  const qs = await searchParams;
  const range = rangeFromQuery(qs);
  const exportQs = new URLSearchParams({
    from: format(range.from, "yyyy-MM-dd"),
    to: format(range.to, "yyyy-MM-dd"),
  }).toString();

  const [funnel, byWeek, byDept, vehicle, driver, cancellations] = await Promise.all([
    approvalFunnel(range),
    requestVolumeByWeek(range),
    requestVolumeByDepartment(range),
    vehicleUtilisation(range),
    driverUtilisation(range),
    repeatCancellers(range),
  ]);

  return (
    <div className="space-y-6 print:space-y-3">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            {format(range.from, "d MMM yyyy")} – {format(range.to, "d MMM yyyy")}
          </p>
        </div>
        <div className="flex items-end gap-3">
          <RangeFilter from={range.from} to={range.to} />
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 print:grid-cols-3">
        <KpiCard label="Total requests" value={funnel.total} />
        <KpiCard label="Approved" value={funnel.approved} sub={`${pct(funnel.approved, funnel.total)} of total`} />
        <KpiCard label="Cancelled" value={funnel.cancelled} sub={`${pct(funnel.cancelled, funnel.total)} of total`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Request volume by week</CardTitle>
              <Link href={`/api/reports/csv/volume?${exportQs}`} className="text-xs underline print:hidden">CSV</Link>
            </div>
          </CardHeader>
          <CardContent>
            {byWeek.length > 0 ? <VolumeBarChart data={byWeek} /> : <Empty />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Approval funnel</CardTitle>
              <Link href={`/api/reports/csv/funnel?${exportQs}`} className="text-xs underline print:hidden">CSV</Link>
            </div>
          </CardHeader>
          <CardContent>
            <FunnelPieChart
              data={[
                { label: "Approved", value: funnel.approved },
                { label: "Denied", value: funnel.denied },
                { label: "Cancelled", value: funnel.cancelled },
                { label: "Outsourced", value: funnel.outsourced },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Request volume by department</CardTitle>
            <Link href={`/api/reports/csv/department?${exportQs}`} className="text-xs underline print:hidden">CSV</Link>
          </div>
        </CardHeader>
        <CardContent>
          {byDept.length === 0 ? <Empty /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
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
            <CardTitle>Vehicle utilisation</CardTitle>
            <Link href={`/api/reports/csv/vehicles?${exportQs}`} className="text-xs underline print:hidden">CSV</Link>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehicle</TableHead>
                <TableHead className="text-right">Trips</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Km</TableHead>
                <TableHead className="text-right">Fuel ฿</TableHead>
                <TableHead className="text-right">Tollway ฿</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicle.map((v) => (
                <TableRow key={v.registrationNumber}>
                  <TableCell>{v.registrationNumber}</TableCell>
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
            <CardTitle>Driver utilisation</CardTitle>
            <Link href={`/api/reports/csv/drivers?${exportQs}`} className="text-xs underline print:hidden">CSV</Link>
          </div>
        </CardHeader>
        <CardContent>
          {driver.length === 0 ? <Empty /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Driver</TableHead>
                  <TableHead className="text-right">Trips</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
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
            <CardTitle>Repeat cancellers</CardTitle>
            <Link href={`/api/reports/csv/cancellations?${exportQs}`} className="text-xs underline print:hidden">CSV</Link>
          </div>
        </CardHeader>
        <CardContent>
          {cancellations.length === 0 ? <Empty /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Cancellations</TableHead>
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
        Tip: print this page (Cmd-P) to share with the supervising professor.
      </p>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-3xl font-semibold mt-1">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Empty() {
  return <p className="py-8 text-center text-sm text-muted-foreground">No data in range.</p>;
}

function pct(n: number, total: number) {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}
