import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  approvalFunnel,
  driverUtilisation,
  rangeFromQuery,
  repeatCancellers,
  requestVolumeByDepartment,
  requestVolumeByWeek,
  vehicleUtilisation,
} from "@/lib/reporting/metrics";

function csv(rows: Array<Array<string | number>>): string {
  return rows
    .map((r) =>
      r.map((cell) => {
        const s = String(cell);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","),
    )
    .join("\n");
}

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  // Admins always; approvers limited to their dept on the dept-usage page.
  const isAdmin = session.user.roles.includes("ADMIN");
  if (!isAdmin) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const range = rangeFromQuery({ from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined });
  const { kind } = await params;

  let rows: Array<Array<string | number>>;
  switch (kind) {
    case "volume": {
      const data = await requestVolumeByWeek(range);
      rows = [["week", "count"], ...data.map((d) => [d.week, d.count])];
      break;
    }
    case "funnel": {
      const f = await approvalFunnel(range);
      rows = [
        ["bucket", "count"],
        ["total", f.total],
        ["approved", f.approved],
        ["denied", f.denied],
        ["cancelled", f.cancelled],
        ["completed", f.completed],
        ["outsourced", f.outsourced],
      ];
      break;
    }
    case "department": {
      const data = await requestVolumeByDepartment(range);
      rows = [["department", "count"], ...data.map((d) => [d.department, d.count])];
      break;
    }
    case "vehicles": {
      const data = await vehicleUtilisation(range);
      rows = [
        ["vehicle", "trips", "hours", "km", "fuel_thb", "tollway_thb"],
        ...data.map((v) => [
          v.registrationNumber,
          v.trips,
          v.hours.toFixed(2),
          v.km,
          v.fuel.toFixed(2),
          v.tollway.toFixed(2),
        ]),
      ];
      break;
    }
    case "drivers": {
      const data = await driverUtilisation(range);
      rows = [
        ["driver", "trips", "hours"],
        ...data.map((d) => [d.name, d.trips, d.hours.toFixed(2)]),
      ];
      break;
    }
    case "cancellations": {
      const data = await repeatCancellers(range);
      rows = [["user", "cancellations"], ...data.map((c) => [c.name, c.cancellations])];
      break;
    }
    default:
      return new NextResponse("Unknown report", { status: 404 });
  }

  return new NextResponse(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}.csv"`,
    },
  });
}
