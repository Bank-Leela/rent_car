import Link from "next/link";
import { format, isSameDay, addDays, startOfDay } from "date-fns";
import { th, enUS, type Locale } from "date-fns/locale";
import { CalendarCheck, ChevronRight, MapPin, ArrowRight, ArrowRightLeft, Car, UserRound, Phone, Plus } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { HeroBand } from "@/components/hero-band";
import { Button } from "@/components/ui/button";
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
  // `requester.newBooking` ("จองใหม่") has existed in th.json all along and was
  // rendered nowhere — the band CTA can use it without adding a key.
  const tr = await getTranslations("requester");
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

  // Said in the band rather than discovered by scrolling. The page already holds
  // every row, so these cost nothing — and "how much is coming, and is any of it
  // already sorted" is the question this page exists to answer.
  const withCar = trips.filter((b) => !!b.primaryDriver).length;
  const stats = [
    { label: t("title"), value: trips.length },
    { label: t("driver"), value: `${withCar}/${trips.length}`, tone: "good" as const },
  ];

  return (
    // -space-y at the top would fight the band's bleed, so the band sits outside
    // the rhythm and the sections keep their own.
    <div className="space-y-8">
      <HeroBand
        title={t("title")}
        description={t("description")}
        icon={CalendarCheck}
        stats={trips.length > 0 ? stats : undefined}
        actions={
          // nativeButton={false} because this renders as an <a>: without it Base
          // UI keeps native button semantics on a link, which it warns about and
          // which breaks the element's real role.
          <Button
            size="xl"
            variant="secondary"
            nativeButton={false}
            render={<Link href="/requester/new" />}
          >
            <Plus aria-hidden />
            {tr("newBooking")}
          </Button>
        }
      />

      {trips.length === 0 ? (
        <EmptyState icon={CalendarCheck} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="space-y-10">
          {todayTrips.length > 0 && (
            <DaySection
              label={t("today")}
              plate={{ day: format(now, "d"), month: format(now, "MMM", { locale: dfLocale }) }}
              trips={todayTrips}
              t={t}
              tf={tf}
              tv={tv}
              isThai={isThai}
              now={now}
            />
          )}
          {tomorrowTrips.length > 0 && (
            <DaySection
              label={t("tomorrow")}
              plate={{ day: format(tomorrow, "d"), month: format(tomorrow, "MMM", { locale: dfLocale }) }}
              trips={tomorrowTrips}
              t={t}
              tf={tf}
              tv={tv}
              isThai={isThai}
              now={now}
            />
          )}
          {laterGroups.map((g) => (
            <DaySection
              key={g.key}
              label={format(g.date, "EEEE d MMMM", { locale: dfLocale })}
              plate={{ day: format(g.date, "d"), month: format(g.date, "MMM", { locale: dfLocale }) }}
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
  plate,
  trips,
  t,
  tf,
  tv,
  isThai,
  now,
}: {
  label: string;
  /** The date as a plate: big numeral + short month. */
  plate: { day: string; month: string };
  trips: Trip[];
  t: Translator;
  tf: FormTranslator;
  tv: FleetTranslator;
  isThai: boolean;
  now: Date;
}) {
  return (
    <section className="space-y-4">
      {/* The date is the emotional content of this page and it was 14px grey
          uppercase — smaller than the metadata inside the cards below it. A plate
          with a large tabular numeral gives each day an anchor you can find while
          scrolling a month of trips, and the count says how heavy the day is
          before you read it. */}
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
          <span className="text-lg font-semibold leading-none tabular-nums">{plate.day}</span>
          <span className="text-[10px] font-medium uppercase leading-none tracking-wide opacity-80">
            {plate.month}
          </span>
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-[-0.01em]">{label}</h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            {trips.length} {t("title")}
          </p>
        </div>
        <div className="ml-1 hidden h-px flex-1 bg-border sm:block" />
      </div>
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
    // card-lift is already defined in globals.css (and already
    // reduced-motion-guarded) but only two admin pages ever used it. shadow-e1 →
    // e2 on hover is the same elevation vocabulary the Card primitive now uses.
    <div
      className={`card-lift flex flex-col gap-3 overflow-hidden rounded-xl border bg-card shadow-e1 hover:shadow-e2 ${
        hasDriver ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-border"
      }`}
    >
      {/* The card's own header strip. The time is the first thing a requester
          looks for and it used to be a 12px grey run-on line UNDER the route, in
          the same breath as "one-way / round trip". Here it leads, at display
          size and tabular, so a column of cards can be scanned down the hour. */}
      <div className="flex items-baseline justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-xl font-semibold leading-none tracking-[-0.02em] tabular-nums">
            {format(b.startAt, "HH:mm")}
          </span>
          <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
            –{format(b.endAt, "HH:mm")}
          </span>
        </div>
        <BookingStatusBadge status={b.status} audience="requester" />
      </div>

      <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
      {/* The detail link used to sit alone on the card's first row, right-aligned
          above the destination, which left a visibly empty band across the top of
          every card. It is a footer action, so it goes in the footer. */}

      {/* The destination is why the trip exists, so it is the biggest thing in
          the body — it used to sit at 14px inside a grey box, the same size as
          the pickup point it was paired with, which made every card in the grid
          look identical from arm's length. The pickup stays small underneath:
          it is nearly always the same building. */}
      <div className="min-w-0">
        <p className="truncate text-base font-semibold leading-snug tracking-[-0.01em]">
          {b.destination}
        </p>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{b.pickupLocation || t("pickup")}</span>
          {b.returnTrip ? (
            <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          <span className="shrink-0">{b.returnTrip ? tf("returnTripYes") : tf("returnTripNo")}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {formatTh(b.startAt, "EEE d MMM")}
        </p>
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

      {/* No document download here. The official form is the transport office's
          paperwork — they print it, collect the signature and file it — so it
          belongs on the admin surfaces only.
          ?from: the detail page's back arrow returns to THIS board rather than
          dumping the requester in the request log they never opened.
          min-h-11 keeps the only tap target on the card at 44px. */}
      <Link
        href={`/requester/${b.id}?from=upcoming`}
        className="-mb-1 mt-auto inline-flex min-h-11 items-center justify-end gap-0.5 self-end rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("detailLink")}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
      </div>
    </div>
  );
}
