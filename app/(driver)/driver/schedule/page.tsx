import Link from "next/link";
import { addDays, format, parse, startOfDay } from "date-fns";
import { th, enUS } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { daySpan, daySuperscript } from "@/lib/booking/day-window";
import { PageHeader } from "@/components/page-header";
import { DriverScheduleBoard } from "@/components/driver/driver-schedule-board";
import type { SchedulerBooking } from "@/components/admin/scheduler-board-shared";

const hm = (d: Date) => (d.getMinutes() === 0 ? format(d, "HH") : format(d, "HH:mm"));

// Driver-side READ-ONLY view of P'Top's official schedule (all cars). The shared
// "driverstation" login lands here. Editable draft/trade board is separate.
export default async function DriverSchedule({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole("DRIVER");
  const t = await getTranslations("scheduler");
  const td = await getTranslations("driver");
  const locale = await getLocale();
  const dfLocale = locale.toLowerCase().startsWith("th") ? th : enUS;
  const isThai = locale.toLowerCase().startsWith("th");

  const { date } = await searchParams;
  const day = date ? parse(date, "yyyy-MM-dd", new Date()) : new Date();
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  const [vehicles, dayBookings, onCall] = await Promise.all([
    prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: { registrationNumber: "asc" },
      select: {
        id: true,
        registrationNumber: true,
        assignedDriverId: true,
        assignedDriver: { select: { user: { select: { name: true, thaiName: true } } } },
      },
    }),
    prisma.booking.findMany({
      where: { status: { in: ["APPROVED", "ASSIGNED"] }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
      orderBy: { startAt: "asc" },
      select: {
        id: true, jobNumber: true, purpose: true, destination: true, startAt: true, endAt: true,
        vehicleId: true, jobType: true, estimatedDistance: true,
        primaryDriverId: true, secondaryDriverId: true,
        primaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
        secondaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
      },
    }),
    prisma.onCallShift.findUnique({ where: { date: dayStart }, select: { driverId: true } }),
  ]);

  const dutyDriverId = onCall?.driverId ?? null;
  const dutyVehicleId = dutyDriverId ? vehicles.find((v) => v.assignedDriverId === dutyDriverId)?.id ?? null : null;
  const carByDriver = new Map<string, string>();
  for (const v of vehicles) if (v.assignedDriverId) carByDriver.set(v.assignedDriverId, v.id);
  const nameOf = (u: { name: string | null; thaiName: string | null } | null | undefined) =>
    u ? (isThai ? u.thaiName ?? u.name : u.name ?? u.thaiName) ?? null : null;

  const vehicleRows = vehicles.map((v) => ({
    id: v.id,
    registrationNumber: v.registrationNumber,
    driverName: nameOf(v.assignedDriver?.user),
  }));

  const bookings: SchedulerBooking[] = dayBookings.map((b) => {
    const span = daySpan(b.startAt, b.endAt, dayStart, dayEnd);
    return {
      id: b.id,
      jobNumber: b.jobNumber,
      purpose: b.purpose,
      destination: b.destination,
      timeLabel: span.continuesBefore ? `↪ ${format(b.startAt, "EEE d MMM", { locale: dfLocale })}` : hm(b.startAt),
      endLabel: span.continuesAfter
        ? `${hm(b.endAt)} ↩ ${format(b.endAt, "EEE d MMM", { locale: dfLocale })}`
        : hm(b.endAt),
      departLabel: hm(b.startAt) + daySuperscript(b.startAt, dayStart),
      arriveLabel: hm(b.endAt) + daySuperscript(b.endAt, dayStart),
      startHour: span.startHour,
      endHour: span.endHour,
      continuesBefore: span.continuesBefore,
      continuesAfter: span.continuesAfter,
      vehicleId: b.vehicleId,
      jobType: b.jobType,
      hasDriver: b.primaryDriverId != null,
      driverName: nameOf(b.primaryDriver?.user),
      secondaryDriverName: nameOf(b.secondaryDriver?.user),
      secondaryDriverId: b.secondaryDriverId,
      secondaryVehicleId: b.secondaryDriverId ? carByDriver.get(b.secondaryDriverId) ?? null : null,
      needsCoDriver: false,
      reco: null,
    };
  });

  const isoOf = (d: Date) => format(d, "yyyy-MM-dd");
  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader title={td("scheduleTitle")} description={td("scheduleSubtitle")} />
        <div className="flex items-center gap-2">
          <Link href={`/driver/schedule?date=${isoOf(addDays(dayStart, -1))}`} className={navBtn} aria-label={t("prevDay")}>
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-40 text-center text-sm font-medium">
            {format(day, "EEE d MMM yyyy", { locale: dfLocale })}
          </span>
          <Link href={`/driver/schedule?date=${isoOf(addDays(dayStart, 1))}`} className={navBtn} aria-label={t("nextDay")}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <DriverScheduleBoard
        vehicles={vehicleRows}
        bookings={bookings}
        dutyVehicleId={dutyVehicleId}
        labels={{
          duty: t("duty"),
          noDriver: t("noDriver"),
          coDriver: t("coDriver"),
          arrives: t("arrives"),
          empty: t("noVehicles"),
        }}
      />
    </div>
  );
}
