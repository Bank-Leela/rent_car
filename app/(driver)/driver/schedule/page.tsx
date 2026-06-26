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
import { DriverDraftBoard } from "@/components/driver/driver-draft-board";
import type { SchedulerBooking } from "@/components/admin/scheduler-board-shared";

const hm = (d: Date) => (d.getMinutes() === 0 ? format(d, "HH") : format(d, "HH:mm"));

// Driver-side board. The shared "driverstation" login lands here. Two tabs:
// "official" = P'Top's read-only schedule; "draft" = an editable trade board
// (drags write BookingDraft rows only — never the official assignment — and
// Submit hands the draft to P'Top to apply).
export default async function DriverSchedule({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string }>;
}) {
  await requireRole("DRIVER");
  const t = await getTranslations("scheduler");
  const td = await getTranslations("driver");
  const locale = await getLocale();
  const dfLocale = locale.toLowerCase().startsWith("th") ? th : enUS;
  const isThai = locale.toLowerCase().startsWith("th");

  const { date, tab } = await searchParams;
  const view = tab === "draft" ? "draft" : "official";
  const day = date ? parse(date, "yyyy-MM-dd", new Date()) : new Date();
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  const [vehicles, dayBookings, onCall, drafts] = await Promise.all([
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
    prisma.bookingDraft.findMany({ select: { bookingId: true, proposedVehicleId: true, submitted: true } }),
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

  // Draft overlay: a draft row reassigns its booking to proposedVehicleId (or
  // the queue when null). Marked "moved" so the driver sees their own edits.
  const draftMap = new Map(drafts.map((d) => [d.bookingId, d.proposedVehicleId]));
  const draftView = bookings.map((b) =>
    draftMap.has(b.id) ? { ...b, vehicleId: draftMap.get(b.id) ?? null } : b,
  );
  const draftOnCar = draftView.filter((b) => b.vehicleId != null);
  const draftQueue = draftView.filter((b) => b.vehicleId == null);
  const movedIds = bookings.filter((b) => draftMap.has(b.id)).map((b) => b.id);
  // Badge + Submit/Reset state reflect only the viewed day's bookings — the
  // draft store is global, but the board (and its actions) are day-scoped.
  const dayIds = new Set(dayBookings.map((b) => b.id));
  const dayDrafts = drafts.filter((d) => dayIds.has(d.bookingId));
  const hasUnsubmittedDraft = dayDrafts.some((d) => !d.submitted);
  const submittedDraft = dayDrafts.some((d) => d.submitted);

  const isoOf = (d: Date) => format(d, "yyyy-MM-dd");
  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const tabSuffix = view === "draft" ? "&tab=draft" : "";
  const tabCls = (active: boolean) =>
    `inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "border hover:bg-muted"
    }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader title={td("scheduleTitle")} description={td("scheduleSubtitle")} />
        <div className="flex items-center gap-2">
          <Link href={`/driver/schedule?date=${isoOf(addDays(dayStart, -1))}${tabSuffix}`} className={navBtn} aria-label={t("prevDay")}>
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-40 text-center text-sm font-medium">
            {format(day, "EEE d MMM yyyy", { locale: dfLocale })}
          </span>
          <Link href={`/driver/schedule?date=${isoOf(addDays(dayStart, 1))}${tabSuffix}`} className={navBtn} aria-label={t("nextDay")}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b pb-3">
        <Link href={`/driver/schedule?date=${isoOf(dayStart)}`} className={tabCls(view === "official")}>
          {td("tabOfficial")}
        </Link>
        <Link href={`/driver/schedule?date=${isoOf(dayStart)}&tab=draft`} className={tabCls(view === "draft")}>
          {td("tabDraft")}
          {(hasUnsubmittedDraft || submittedDraft) && (
            <span className={`ml-1.5 inline-block h-2 w-2 rounded-full ${submittedDraft ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
          )}
        </Link>
      </div>

      {view === "official" ? (
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
      ) : (
        <DriverDraftBoard
          vehicles={vehicleRows}
          bookings={draftOnCar}
          queue={draftQueue}
          movedIds={movedIds}
          hasUnsubmittedDraft={hasUnsubmittedDraft}
          submittedDraft={submittedDraft}
          labels={{
            duty: t("duty"),
            noDriver: t("noDriver"),
            coDriver: t("coDriver"),
            arrives: t("arrives"),
            empty: t("noVehicles"),
            queue: td("draftQueue"),
            queueEmpty: td("draftQueueEmpty"),
            moved: td("draftMoved"),
            submit: td("draftSubmit"),
            submitted: td("draftSubmitted"),
            reset: td("draftReset"),
            withdraw: td("draftWithdraw"),
            hint: td("draftHint"),
            lockedHint: td("draftLockedHint"),
            error: td("draftError"),
          }}
        />
      )}
    </div>
  );
}
