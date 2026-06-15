import Link from "next/link";
import { addDays, format, parse, startOfDay } from "date-fns";
import { th, enUS } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { SchedulerBoard } from "@/components/admin/scheduler-board";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireRole("ADMIN");
  const t = await getTranslations("scheduler");
  const locale = await getLocale();
  const dfLocale = locale.toLowerCase().startsWith("th") ? th : enUS;

  const { date } = await searchParams;
  const day = date ? parse(date, "yyyy-MM-dd", new Date()) : new Date();
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  const [vehicles, dayBookings, onCall] = await Promise.all([
    prisma.vehicle.findMany({
      where: { isActive: true },
      // Stable order so the A–F labels stay put day-to-day (duty rotates, not the label).
      orderBy: { registrationNumber: "asc" },
      select: {
        id: true,
        registrationNumber: true,
        assignedDriverId: true,
        assignedDriver: { select: { user: { select: { name: true, thaiName: true } } } },
      },
    }),
    prisma.booking.findMany({
      where: {
        status: { in: ["APPROVED", "ASSIGNED"] },
        startAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        jobNumber: true,
        purpose: true,
        destination: true,
        startAt: true,
        endAt: true,
        vehicleId: true,
        jobType: true,
        primaryDriverId: true,
        secondaryDriverId: true,
        primaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
        secondaryDriver: { select: { user: { select: { name: true, thaiName: true } } } },
      },
    }),
    prisma.onCallShift.findUnique({ where: { date: dayStart }, select: { driverId: true } }),
  ]);

  // car=driver: the duty car is the on-call driver's own car — always resolvable.
  const dutyDriverId = onCall?.driverId ?? null;
  const dutyVehicleId = dutyDriverId
    ? vehicles.find((v) => v.assignedDriverId === dutyDriverId)?.id ?? null
    : null;

  const isThai = locale.toLowerCase().startsWith("th");
  // car=driver: which car each driver is assigned to, to place a co-driver ghost.
  const carByDriver = new Map<string, string>();
  for (const v of vehicles) if (v.assignedDriverId) carByDriver.set(v.assignedDriverId, v.id);
  const vehicleRows = vehicles.map((v) => {
    const du = v.assignedDriver?.user;
    const driverName = du ? (isThai ? du.thaiName ?? du.name : du.name ?? du.thaiName) ?? null : null;
    return { id: v.id, registrationNumber: v.registrationNumber, driverName };
  });
  const bookings = dayBookings.map((b) => {
    const u = b.primaryDriver?.user;
    const driverName = u ? (isThai ? u.thaiName ?? u.name : u.name ?? u.thaiName) ?? null : null;
    const su = b.secondaryDriver?.user;
    const secondaryDriverName = su ? (isThai ? su.thaiName ?? su.name : su.name ?? su.thaiName) ?? null : null;
    const sameDay = b.endAt.toDateString() === b.startAt.toDateString();
    return {
      id: b.id,
      jobNumber: b.jobNumber,
      purpose: b.purpose,
      destination: b.destination,
      timeLabel: format(b.startAt, "HH:mm"),
      startHour: b.startAt.getHours() + b.startAt.getMinutes() / 60,
      endHour: sameDay ? b.endAt.getHours() + b.endAt.getMinutes() / 60 : 24,
      vehicleId: b.vehicleId,
      hasDriver: b.primaryDriverId != null,
      driverName,
      secondaryDriverName,
      secondaryDriverId: b.secondaryDriverId,
      secondaryVehicleId: b.secondaryDriverId ? carByDriver.get(b.secondaryDriverId) ?? null : null,
    };
  });

  const isoOf = (d: Date) => format(d, "yyyy-MM-dd");
  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/schedule?date=${isoOf(addDays(dayStart, -1))}`}
            className={navBtn}
            aria-label={t("prevDay")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-40 text-center text-sm font-medium">
            {format(day, "EEE d MMM yyyy", { locale: dfLocale })}
          </span>
          <Link
            href={`/admin/schedule?date=${isoOf(addDays(dayStart, 1))}`}
            className={navBtn}
            aria-label={t("nextDay")}
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <SchedulerBoard vehicles={vehicleRows} bookings={bookings} dutyVehicleId={dutyVehicleId} />
    </div>
  );
}
