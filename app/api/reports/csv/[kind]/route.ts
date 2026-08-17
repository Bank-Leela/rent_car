import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  approvalFunnel,
  driverUtilisation,
  rangeFromQuery,
  repeatCancellers,
  requestVolumeByDepartment,
  requestVolumeByMonth,
  vehicleUtilisation,
} from "@/lib/reporting/metrics";

/**
 * Excel ignores the HTTP `charset=utf-8` for a .csv it opens from disk and falls
 * back to the local ANSI code page, so without a byte-order mark every Thai cell
 * — department names, driver names, and the license plates that identify a
 * vehicle row — arrived as mojibake. These files exist to be opened in Excel, so
 * the BOM is not optional. CRLF for the same reason: it is what RFC 4180 and
 * Excel expect.
 */
const UTF8_BOM = "﻿";

function csv(rows: Array<Array<string | number>>): string {
  return (
    UTF8_BOM +
    rows
      .map((r) =>
        r.map((cell) => {
          const s = String(cell);
          // A leading =, +, - or @ makes Excel treat the cell as a formula.
          // Prefix with a tab so it stays text — the value still reads the same.
          const safe = /^[=+\-@]/.test(s) ? `\t${s}` : s;
          return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        }).join(","),
      )
      .join("\r\n")
  );
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
      const data = await requestVolumeByMonth(range);
      rows = [["month", "count"], ...data.map((d) => [d.month, d.count])];
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
