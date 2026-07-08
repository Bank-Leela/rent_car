import Link from "next/link";
import { format, startOfDay, endOfDay, addDays, isSameDay } from "date-fns";
import { CalendarCheck, Check, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { RequesterBookingList } from "@/components/requester-booking-list";

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

  // Confirmed today/tomorrow (driver assigned) + the rest of the pipeline:
  // requests still awaiting approval and over-capacity waitlist bookings used to
  // be invisible here, leaving the requester unsure whether a submission was
  // processing or stuck. Now each state gets its own section.
  const [trips, pending, waitlisted] = await Promise.all([
    prisma.booking.findMany({
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
    }),
    prisma.booking.findMany({
      where: {
        requesterId: session.user.id,
        status: "PENDING_APPROVAL",
        startAt: { gte: windowStart },
      },
      orderBy: { startAt: "asc" },
      include: { vehicle: true },
    }),
    prisma.booking.findMany({
      where: {
        requesterId: session.user.id,
        status: "WAITLIST",
        startAt: { gte: windowStart },
      },
      orderBy: { startAt: "asc" },
      include: { vehicle: true },
    }),
  ]);

  const today = trips.filter((b) => isSameDay(b.startAt, now));
  const tomorrow = trips.filter((b) => !isSameDay(b.startAt, now));
  const nothing = trips.length === 0 && pending.length === 0 && waitlisted.length === 0;

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />

      {nothing ? (
        <EmptyState icon={CalendarCheck} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <div className="space-y-8">
          {today.length > 0 && <DaySection label={t("today")} trips={today} t={t} />}
          {tomorrow.length > 0 && <DaySection label={t("tomorrow")} trips={tomorrow} t={t} />}
          {pending.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("sectionPending")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("sectionPendingHint")}</p>
              <RequesterBookingList bookings={pending} />
            </section>
          )}
          {waitlisted.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                {t("sectionWaitlist")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("sectionWaitlistHint")}</p>
              <RequesterBookingList bookings={waitlisted} />
            </section>
          )}
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

// Status-page–style row: a left-accent card with a status chip + a detail link,
// then one compact line (destination · time · car). Full driver/vehicle/pickup
// details live on the booking-detail page behind the รายละเอียด link.
function TripCard({ b, t }: { b: Trip; t: Translator }) {
  const car = b.vehicle?.registrationNumber ?? "—";
  const done = b.status === "COMPLETED";
  return (
    <div
      className={`rounded-lg border border-l-4 bg-card p-3.5 shadow-sm ${
        done ? "border-l-muted-foreground/40" : "border-l-emerald-500"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              done
                ? "bg-muted text-muted-foreground"
                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            }`}
          >
            <Check className="h-3 w-3" aria-hidden />
            {done ? t("statusCompleted") : t("statusConfirmed")}
          </span>
        </div>
        <Link
          href={`/requester/${b.id}`}
          className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary hover:underline"
        >
          {t("detailLink")}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <p className="mt-1.5 truncate text-sm">
        <span className="font-medium">{b.destination}</span>
        <span className="text-muted-foreground">
          {" · "}
          {format(b.startAt, "HH:mm")}–{format(b.endAt, "HH:mm")}
          {" · "}
          {car}
        </span>
      </p>
    </div>
  );
}
