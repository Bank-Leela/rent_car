import Link from "next/link";
import { format, startOfDay, endOfDay, addDays, isSameDay } from "date-fns";
import { CalendarCheck, Car, User, Phone, MapPin, Users, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

type Translator = Awaited<ReturnType<typeof getTranslations<"requesterUpcoming">>>;
type Trip = Prisma.BookingGetPayload<{
  include: {
    vehicle: true;
    primaryDriver: { include: { user: true } };
    secondaryDriver: { include: { user: true } };
  };
}>;

// Requester-facing confirmation: their driver + details for today and tomorrow.
// Only trips that already have a driver assigned (confirmed) are shown.
export default async function RequesterUpcoming() {
  const session = await requireRole("REQUESTER");
  const t = await getTranslations("requesterUpcoming");
  const now = new Date();
  const windowStart = startOfDay(now);
  const windowEnd = endOfDay(addDays(now, 1)); // through end of tomorrow

  const trips = await prisma.booking.findMany({
    where: {
      requesterId: session.user.id,
      primaryDriverId: { not: null },
      status: { in: ["APPROVED", "ASSIGNED", "COMPLETED"] },
      startAt: { gte: windowStart, lte: windowEnd },
    },
    orderBy: { startAt: "asc" },
    include: {
      vehicle: true,
      primaryDriver: { include: { user: true } },
      secondaryDriver: { include: { user: true } },
    },
  });

  const today = trips.filter((b) => isSameDay(b.startAt, now));
  const tomorrow = trips.filter((b) => !isSameDay(b.startAt, now));

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />

      {trips.length === 0 ? (
        <EmptyState icon={CalendarCheck} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="space-y-8">
          {today.length > 0 && <DaySection label={t("today")} trips={today} t={t} />}
          {tomorrow.length > 0 && <DaySection label={t("tomorrow")} trips={tomorrow} t={t} />}
        </div>
      )}
    </div>
  );
}

function DaySection({ label, trips, t }: { label: string; trips: Trip[]; t: Translator }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
      <div className="space-y-3">
        {trips.map((b) => (
          <TripCard key={b.id} b={b} t={t} />
        ))}
      </div>
    </section>
  );
}

function TripCard({ b, t }: { b: Trip; t: Translator }) {
  const driverName = b.primaryDriver?.user.name ?? b.primaryDriver?.user.email ?? "—";
  const driverPhone = b.primaryDriver?.user.phone ?? null;
  const coDriverName = b.secondaryDriver?.user.name ?? b.secondaryDriver?.user.email ?? null;

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      {/* Header links to the full booking detail. Kept separate from the phone
          link below so we never nest <a> inside <a>. */}
      <Link
        href={`/requester/${b.id}`}
        className="group flex items-start justify-between gap-4 rounded-md hover:opacity-90"
      >
        <div className="min-w-0">
          <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-xl font-semibold tabular-nums">
              {format(b.startAt, "HH:mm")}–{format(b.endAt, "HH:mm")}
            </span>
            <span className="truncate text-base font-medium">{b.destination}</span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{b.province}</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>

      <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2">
        {/* Driver — the headline of this card. */}
        <div className="flex items-start gap-2">
          <User className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("driver")}</div>
            <div className="font-medium">{driverName}</div>
            {driverPhone ? (
              <a
                href={`tel:${driverPhone}`}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <Phone className="h-3.5 w-3.5" aria-hidden />
                {driverPhone}
              </a>
            ) : (
              <div className="text-sm text-muted-foreground">{t("noPhone")}</div>
            )}
          </div>
        </div>

        {/* Vehicle */}
        <div className="flex items-start gap-2">
          <Car className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("vehicle")}</div>
            <div className="font-medium">{b.vehicle?.registrationNumber ?? "—"}</div>
            {coDriverName && (
              <div className="text-sm text-muted-foreground">
                {t("coDriver")}: {coDriverName}
              </div>
            )}
          </div>
        </div>

        {/* Pickup + passengers */}
        {b.pickupLocation && (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("pickup")}</div>
              <div className="text-sm">{b.pickupLocation}</div>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4 shrink-0" aria-hidden />
          {t("passengers", { count: b.passengerCount })}
        </div>
      </div>
    </div>
  );
}
