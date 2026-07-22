import Link from "next/link";
import { Plus, FileText, Star } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  ACTIVE_BOOKING_STATUSES,
  HISTORY_BOOKING_STATUSES,
  type RequesterBookingCard,
} from "@/components/requester-booking-list";
import { RequesterHistoryClient } from "@/components/requester-history-client";

// History log: every request that's run its course — formally COMPLETED/
// DENIED/CANCELLED, or an active-status booking whose scheduled end has simply
// passed (e.g. nobody closed it out). Anything still ahead lives on
// /requester/upcoming instead, so the two pages never show the same booking.
export default async function RequesterHome() {
  const session = await requireRole("REQUESTER");
  const t = await getTranslations("requester");
  const now = new Date();

  const [pendingEvalBookings, history] = await Promise.all([
    prisma.booking.findMany({
      where: {
        requesterId: session.user.id,
        status: "COMPLETED",
        trip: { is: { evaluation: null } },
      },
      select: { id: true, jobNumber: true, purpose: true, destination: true },
    }),
    prisma.booking.findMany({
      where: {
        requesterId: session.user.id,
        OR: [
          { status: { in: HISTORY_BOOKING_STATUSES } },
          { status: { in: ACTIVE_BOOKING_STATUSES }, endAt: { lt: now } },
        ],
      },
      orderBy: { startAt: "desc" },
      include: { vehicle: true },
    }),
  ]);

  // Past-due bookings that were never formally closed out read as done from
  // the requester's point of view — show them as completed here.
  const historyRows: RequesterBookingCard[] = history.map((b) => ({
    id: b.id,
    jobNumber: b.jobNumber,
    status: (HISTORY_BOOKING_STATUSES as readonly string[]).includes(b.status) ? b.status : "COMPLETED",
    purpose: b.purpose,
    destination: b.destination,
    province: b.province,
    startAt: b.startAt,
    vehicle: b.vehicle ? { registrationNumber: b.vehicle.registrationNumber } : null,
  }));

  const newBookingButton = (
    <Link
      href="/requester/new"
      className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Plus className="h-4 w-4" />
      {t("newBooking")}
    </Link>
  );

  return (
    <div className="space-y-8">
      <PageHeader title={t("historyTitle")} description={t("historyDescription")} actions={newBookingButton} />

      {pendingEvalBookings.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              <Star className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {t("pendingEvalTitle", { count: pendingEvalBookings.length })}
              </h2>
              <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-300/90">{t("pendingEvalDescription")}</p>
              <ul className="mt-2 space-y-1">
                {pendingEvalBookings.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/requester/${b.id}`}
                      className="inline-flex min-h-9 items-center gap-1 rounded-sm text-sm font-medium text-amber-900 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-200"
                    >
                      <span className="font-mono text-xs">{b.jobNumber}</span>
                      <span>·</span>
                      <span>{b.purpose}</span>
                      <span className="text-amber-800/80 dark:text-amber-300/80">→ {b.destination}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {historyRows.length === 0 ? (
        <EmptyState icon={FileText} title={t("historyEmptyTitle")} description={t("historyEmptyDescription")} />
      ) : (
        <RequesterHistoryClient bookings={historyRows} />
      )}
    </div>
  );
}
