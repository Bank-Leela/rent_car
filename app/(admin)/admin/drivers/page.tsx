import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { DriversListClient } from "@/components/admin/drivers-list-client";
import { RosterCsvButton } from "@/components/admin/roster-csv-button";
import { CreateDriverForm } from "@/components/forms/create-driver-form";
import { licenseStatus, retirementStatus } from "@/lib/admin/roster-alerts";
import { LeaveRangeForm } from "@/components/admin/leave-range-form";
import { UpcomingLeave, type LeaveBlock } from "@/components/admin/upcoming-leave";
import { LeaveCalendar, type LeaveDay } from "@/components/admin/leave-calendar";
import { formatTh } from "@/lib/format-date";
import { localDayOfDbDate } from "@/lib/booking/db-date";

function parseMonth(s?: string): Date {
  if (!s) return startOfMonth(new Date());
  const d = parse(s, "yyyy-MM", new Date());
  return Number.isNaN(d.getTime()) ? startOfMonth(new Date()) : startOfMonth(d);
}

export default async function AdminDriversPage({
  searchParams,
}: {
  searchParams: Promise<{ leaveMonth?: string }>;
}) {
  await requireRole("ADMIN");
  const t = await getTranslations("adminDrivers");
  const now = new Date();
  const { leaveMonth } = await searchParams;
  const monthAnchor = parseMonth(leaveMonth);

  const drivers = await prisma.driver.findMany({
    orderBy: { user: { name: "asc" } },
    include: {
      user: { select: { name: true, thaiName: true, phone: true } },
      assignedVehicle: { select: { registrationNumber: true } },
    },
  });

  const rows = drivers.map((d) => ({
    id: d.id,
    name: d.user.name ?? d.user.thaiName ?? "—",
    nickname: d.nickname,
    phone: d.user.phone,
    vehicle: d.assignedVehicle?.registrationNumber ?? null,
    isActive: d.isActive,
    // Roster-sheet alert data (license expiry window / BE retirement year) —
    // statuses computed here with the shared helpers so the list badges and
    // the dashboard alerts card always agree.
    licenseType: d.licenseType,
    licenseNumber: d.licenseNumber,
    licenseExpiresAt: d.licenseExpiresAt?.toISOString() ?? null,
    licenseState: licenseStatus(d.licenseExpiresAt, now),
    retirementYear: d.retirementYear,
    retirementState: retirementStatus(d.retirementYear, now),
    position: d.position,
    notes: d.notes,
  }));

  // Leave lives with the drivers, not with a day's board: it is a fact about a
  // person, recorded once for a range, and the schedule page could only ever
  // show it relative to whichever day happened to be on screen.
  //
  // Consecutive days collapse into one block, so a week off reads as one entry
  // rather than seven.
  const today = startOfDay(now);
  const leaveRows = await prisma.driverUnavailability.findMany({
    where: { date: { gte: today, lte: addDays(today, 30) } },
    orderBy: [{ driverId: "asc" }, { date: "asc" }],
    select: { driverId: true, date: true },
  });
  const nameByDriver = new Map(rows.map((r) => [r.id, r.name]));
  const leaveBlocks: LeaveBlock[] = [];
  for (const row of leaveRows) {
    // localDayOfDbDate first: this list DISPLAYS the day and chains adjacent days
    // into blocks, and format() of a read-back @db.Date is the stored date — so
    // every upcoming leave day was shown one day early.
    const iso = format(localDayOfDbDate(row.date), "yyyy-MM-dd");
    const last = leaveBlocks[leaveBlocks.length - 1];
    const isNextDay =
      last &&
      last.driverId === row.driverId &&
      format(addDays(parse(last.to, "yyyy-MM-dd", new Date()), 1), "yyyy-MM-dd") === iso;
    if (isNextDay) last.to = iso;
    else
      leaveBlocks.push({
        driverId: row.driverId,
        name: nameByDriver.get(row.driverId) ?? row.driverId,
        from: iso,
        to: iso,
        label: "",
      });
  }
  for (const b of leaveBlocks) {
    const f = parse(b.from, "yyyy-MM-dd", new Date());
    const tt = parse(b.to, "yyyy-MM-dd", new Date());
    b.label = b.from === b.to ? formatTh(f, "d MMM") : `${formatTh(f, "d MMM")}–${formatTh(tt, "d MMM")}`;
  }
  // The same rows again over the visible grid rather than the 30-day window: the
  // chips above answer "what is coming up", the grid answers "what does next
  // month look like", and a month you page back to is not in the 30 days. The
  // whole grid is queried, neighbouring months included, so those cells are not
  // wrongly blank.
  const gridStart = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 0 });
  const monthLeave = await prisma.driverUnavailability.findMany({
    where: { date: { gte: gridStart, lte: gridEnd } },
    orderBy: [{ date: "asc" }],
    select: { driverId: true, date: true },
  });
  const offByDay = new Map<string, string[]>();
  for (const row of monthLeave) {
    // localDayOfDbDate first, as above — a read-back @db.Date is a UTC midnight,
    // and formatting it directly lands every leave day one cell early.
    const iso = format(localDayOfDbDate(row.date), "yyyy-MM-dd");
    // Names, not plates: this page is about the people. Same label as the chips
    // directly above, so one absence never reads as two different drivers.
    const label = nameByDriver.get(row.driverId) ?? row.driverId;
    const at = offByDay.get(iso);
    if (at) at.push(label);
    else offByDay.set(iso, [label]);
  }
  const offDays: LeaveDay[] = [...offByDay.entries()].map(([iso, names]) => ({
    iso,
    names: names.sort((a, b) => a.localeCompare(b)),
  }));

  // Only a driver who can actually be dispatched can be marked off.
  const schedulable = rows.filter((r) => r.isActive).map((r) => ({ driverId: r.id, name: r.name }));


  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Card>
        <CardHeader>
          <CardTitle>{t("leaveTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LeaveRangeForm drivers={schedulable} defaultFrom={format(today, "yyyy-MM-dd")} />
          <UpcomingLeave blocks={leaveBlocks} />
          <LeaveCalendar
            days={eachDayOfInterval({ start: gridStart, end: gridEnd })}
            monthAnchor={monthAnchor}
            leave={offDays}
            basePath="/admin/drivers"
            param="leaveMonth"
            anchorId="driver-leave-calendar"
            emptyLabel={t("leaveCalendarEmpty")}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("addDriver")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateDriverForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{t("listTitle")}</CardTitle>
            {rows.length > 0 && <RosterCsvButton rows={rows} />}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("emptyList")}</p>
          ) : (
            <DriversListClient drivers={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
