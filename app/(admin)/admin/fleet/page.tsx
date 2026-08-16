import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parse,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { getLocale, getTranslations } from "next-intl/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FleetEditor } from "@/components/admin/fleet-editor";
import { AddVehicleForm } from "@/components/admin/add-vehicle-form";
import { ProvisionDriversButton } from "@/components/admin/provision-drivers-button";
import { LeaveCalendar, type LeaveDay } from "@/components/admin/leave-calendar";
import { localDayOfDbDate } from "@/lib/booking/db-date";

// `offMonth=yyyy-MM` — its own param, so paging the calendar never disturbs
// anything else this page may carry in the query string.
function parseMonth(s?: string): Date {
  if (!s) return startOfMonth(new Date());
  const d = parse(s, "yyyy-MM", new Date());
  return Number.isNaN(d.getTime()) ? startOfMonth(new Date()) : startOfMonth(d);
}

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<{ offMonth?: string }>;
}) {
  await requireRole("ADMIN");
  const t = await getTranslations("fleet");
  const locale = await getLocale();
  const isThai = locale.toLowerCase().startsWith("th");
  const { offMonth } = await searchParams;
  const monthAnchor = parseMonth(offMonth);

  const [cars, drivers, missingProfiles] = await Promise.all([
    prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: { registrationNumber: "asc" },
      select: { id: true, registrationNumber: true, assignedDriverId: true, type: true, capacity: true },
    }),
    prisma.driver.findMany({
      // Only assignable drivers: active profile AND active user.
      where: { isActive: true, user: { is: { isActive: true } } },
      select: { id: true, user: { select: { name: true, thaiName: true } } },
    }),
    // DRIVER-role users with no Driver profile yet (the "add a driver" gap).
    prisma.user.count({
      where: { isActive: true, roles: { some: { role: Role.DRIVER } }, driverProfile: { is: null } },
    }),
  ]);

  const driverOpts = drivers.map((d) => ({
    id: d.id,
    name: (isThai ? d.user.thaiName ?? d.user.name : d.user.name ?? d.user.thaiName) ?? d.id,
  }));

  // Which cars are out, by day. Leave is recorded against the DRIVER, but
  // car = driver — so on this page it reads as the plate that will be sitting in
  // the yard, with the driver's name only as a fallback for a driver who has no
  // car assigned. The whole visible grid is queried, neighbouring months
  // included, so those cells aren't wrongly blank.
  const gridStart = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 0 });
  const monthLeave = await prisma.driverUnavailability.findMany({
    where: { date: { gte: gridStart, lte: gridEnd } },
    orderBy: [{ date: "asc" }],
    select: { driverId: true, date: true },
  });
  const plateByDriver = new Map(
    cars.filter((c) => c.assignedDriverId).map((c) => [c.assignedDriverId!, c.registrationNumber]),
  );
  const nameByDriver = new Map(driverOpts.map((d) => [d.id, d.name]));
  const outByDay = new Map<string, string[]>();
  for (const row of monthLeave) {
    // localDayOfDbDate first: a read-back @db.Date is a UTC midnight, and
    // formatting it directly lands every leave day one day early.
    const iso = format(localDayOfDbDate(row.date), "yyyy-MM-dd");
    const label =
      plateByDriver.get(row.driverId) ?? nameByDriver.get(row.driverId) ?? row.driverId;
    const at = outByDay.get(iso);
    if (at) at.push(label);
    else outByDay.set(iso, [label]);
  }
  const offDays: LeaveDay[] = [...outByDay.entries()].map(([iso, names]) => ({
    iso,
    names: names.sort((a, b) => a.localeCompare(b)),
  }));

  // Flatten the assigned-driver label onto each car so client-side search can
  // match on driver name (derived from already-fetched data — no extra query).
  const driverNameById = new Map(driverOpts.map((d) => [d.id, d.name]));
  const carRows = cars.map((c) => ({
    ...c,
    driverName: c.assignedDriverId ? driverNameById.get(c.assignedDriverId) ?? "" : "",
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <AddVehicleForm drivers={driverOpts} />
      </div>
      {missingProfiles > 0 && (
        <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/40 dark:bg-amber-950/40">
          <div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {t("missingProfilesTitle", { count: missingProfiles })}
            </p>
            <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
              {t("missingProfilesBody")}
            </p>
          </div>
          <ProvisionDriversButton label={t("provisionAction")} busyLabel={t("provisioning")} />
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("offCalendarTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <LeaveCalendar
            days={eachDayOfInterval({ start: gridStart, end: gridEnd })}
            monthAnchor={monthAnchor}
            leave={offDays}
            basePath="/admin/fleet"
            param="offMonth"
            emptyLabel={t("offCalendarEmpty")}
          />
        </CardContent>
      </Card>
      <FleetEditor cars={carRows} drivers={driverOpts} />
    </div>
  );
}
