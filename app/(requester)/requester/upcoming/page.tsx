import Link from "next/link";
import { format, isSameDay, addDays, startOfDay } from "date-fns";
import { th, enUS, type Locale } from "date-fns/locale";
import { CalendarCheck, ChevronRight, MapPin, ArrowRight, ArrowRightLeft, Car, UserRound, Phone } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { ACTIVE_BOOKING_STATUSES } from "@/components/requester-booking-list";
import { formatTh } from "@/lib/format-date";

type Translator = Awaited<ReturnType<typeof getTranslations<"requesterUpcoming">>>;
type FormTranslator = Awaited<ReturnType<typeof getTranslations<"bookingForm">>>;
type FleetTranslator = Awaited<ReturnType<typeof getTranslations<"fleet">>>;
type Trip = Prisma.BookingGetPayload<{
  include: {
    vehicle: true;
    primaryDriver: { include: { user: true } };
    secondaryDriver: { include: { user: true } };
  };
}>;

// Every booking that's still ahead of the requester — pending approval, queued,
// approved, or already assigned a car — from today onward. Anything whose
// scheduled end has passed belongs in the history page (/requester) instead,
// so there's no overlap between the two views.
export default async function RequesterUpcoming() {
  const session = await requireRole("REQUESTER");
  const t = await getTranslations("requesterUpcoming");
  const tf = await getTranslations("bookingForm");
  const tv = await getTranslations("fleet");
  const locale = await getLocale();
  const isThai = locale.toLowerCase().startsWith("th");
  const now = new Date();

  const trips = await prisma.booking.findMany({
    where: {
      requesterId: session.user.id,
      status: { in: ACTIVE_BOOKING_STATUSES },
      endAt: { gte: now },
    },
    orderBy: { startAt: "asc" },
    include: {
      vehicle: true,
      primaryDriver: { include: { user: true } },
      secondaryDriver: { include: { user: true } },
    },
  });

  const dfLocale: Locale = isThai ? th : enUS;
  const tomorrow = addDays(now, 1);
  const startOfTomorrow = addDays(startOfDay(now), 1);
  // The query keeps any booking whose endAt is still ahead, so a multi-day trip
  // that STARTED before today is still in-progress — bucket it (startAt < tomorrow)
  // into Today rather than letting it fall to a past-dated "later" section.
  const todayTrips = trips.filter((b) => b.startAt < startOfTomorrow);
  const tomorrowTrips = trips.filter((b) => isSameDay(b.startAt, tomorrow));
  const laterTrips = trips.filter((b) => b.startAt >= startOfTomorrow && !isSameDay(b.startAt, tomorrow));

  // Beyond tomorrow, group by calendar day (already ascending from the query)
  // instead of dumping everything into one flat bucket — each date gets its
  // own header, same "one section per day" shape as today/tomorrow.
  const laterGroups: { key: string; date: Date; trips: Trip[] }[] = [];
  for (const b of laterTrips) {
    const last = laterGroups[laterGroups.length - 1];
    if (last && isSameDay(last.date, b.startAt)) {
      last.trips.push(b);
    } else {
      laterGroups.push({ key: format(b.startAt, "yyyy-MM-dd"), date: b.startAt, trips: [b] });
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />

      {trips.length === 0 ? (
        <EmptyState icon={CalendarCheck} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="space-y-8">
          {todayTrips.length > 0 && (
            <DaySection label={t("today")} trips={todayTrips} t={t} tf={tf} tv={tv} isThai={isThai} now={now} />
          )}
          {tomorrowTrips.length > 0 && (
            <DaySection label={t("tomorrow")} trips={tomorrowTrips} t={t} tf={tf} tv={tv} isThai={isThai} now={now} />
          )}
          {laterGroups.map((g) => (
            <DaySection
              key={g.key}
              label={format(g.date, "EEEE d MMMM", { locale: dfLocale })}
              trips={g.trips}
              t={t}
              tf={tf}
              tv={tv}
              isThai={isThai}
              now={now}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DaySection({
  label,
  trips,
  t,
  tf,
  tv,
  isThai,
  now,
}: {
  label: string;
  trips: Trip[];
  t: Translator;
  tf: FormTranslator;
  tv: FleetTranslator;
  isThai: boolean;
  now: Date;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {trips.map((b) => (
          <TripCard key={b.id} b={b} t={t} tf={tf} tv={tv} isThai={isThai} now={now} />
        ))}
      </div>
    </section>
  );
}

// Prefer the Thai display name; nickname (if any) wins for drivers since that's
// how requesters/dispatchers actually refer to them day-to-day.
function driverLabel(driver: Trip["primaryDriver"], isThai: boolean): string | null {
  if (!driver) return null;
  if (driver.nickname) return driver.nickname;
  const name = isThai ? driver.user.thaiName ?? driver.user.name : driver.user.name ?? driver.user.thaiName;
  return name ?? driver.user.email;
}

// One card per request, whatever stage it's at. Route + time always show;
// driver/vehicle only once a car has actually been assigned (primaryDriverId).
function TripCard({
  b,
  t,
  tf,
  tv,
  isThai,
  now,
}: {
  b: Trip;
  t: Translator;
  tf: FormTranslator;
  tv: FleetTranslator;
  isThai: boolean;
  now: Date;
}) {
  const driverName = driverLabel(b.primaryDriver, isThai);
  const coDriverName = driverLabel(b.secondaryDriver, isThai);
  const vehicleTypeLabel = b.vehicle ? tv(`type_${b.vehicle.type}`) : null;

  // The driver and car are shown to the requester only from the day before the
  // trip. Earlier than that the assignment is still liable to change — a driver
  // going off sick re-dispatches the trip (leave-core §9b) — and a requester who
  // has already written down a name and phone number will ring the wrong person.
  // One day is the window the office actually treats as settled.
  const DAY_MS = 86_400_000;
  // `now` is threaded from the page rather than read here: a component render
  // must stay pure (react-hooks/purity), and the page already has the single
  // timestamp every section is bucketed against — so the card and the
  // today/tomorrow grouping cannot disagree about what "now" is.
  const withinOneDay = b.startAt.getTime() - now.getTime() <= DAY_MS;
  const showCrew = !!b.primaryDriver && withinOneDay;
  // The left edge still marks "this has a car" as soon as it does, so the
  // requester can see progress without being given details that may move.
  const hasDriver = !!b.primaryDriver;

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-l-4 bg-card p-4 shadow-sm ${
        hasDriver ? "border-l-emerald-500" : "border-l-border"
      }`}
    >
      {/* Header: job number + status, detail link */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <BookingStatusBadge status={b.status} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* No document download here. The official form is the transport
              office's paperwork — they print it, collect the signature and file
              it — so it belongs on the admin surfaces only. Offering it to the
              requester invited them to submit their own copy, and made the card
              busier than the one thing it is for: where and when. */}
          {/* ?from: the detail page's back arrow returns to THIS board rather
              than dumping the requester in the request log they never opened. */}
          <Link
            href={`/requester/${b.id}?from=upcoming`}
            className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary hover:underline"
          >
            {t("detailLink")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>

      {/* Route: pickup → destination, with a round-trip / one-way badge */}
      <div className="space-y-1 rounded-lg bg-muted/30 p-2.5">
        <div className="flex items-center gap-1.5 text-sm">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate">{b.pickupLocation || t("pickup")}</span>
          {b.returnTrip ? (
            <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 truncate font-medium">{b.destination}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{formatTh(b.startAt, "EEE d MMM · HH:mm")}–{format(b.endAt, "HH:mm")}</span>
          <span>·</span>
          <span>{b.returnTrip ? tf("returnTripYes") : tf("returnTripNo")}</span>
        </div>
      </div>

      {/* Driver + vehicle — assigned AND within a day of departure (see showCrew) */}
      {showCrew && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-start gap-2 rounded-lg border p-2.5">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("driver")}</p>
              <p className="truncate text-sm font-medium">{driverName ?? "—"}</p>
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                <Phone className="h-3 w-3 shrink-0" aria-hidden />
                {b.primaryDriver?.user.phone || t("noPhone")}
              </p>
              {coDriverName && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {t("coDriver")}: {coDriverName}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border p-2.5">
            <Car className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("vehicle")}</p>
              <p className="truncate text-sm font-medium">{b.vehicle?.registrationNumber ?? "—"}</p>
              {vehicleTypeLabel && <p className="truncate text-xs text-muted-foreground">{vehicleTypeLabel}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
