import Link from "next/link";
import { FileText, Star, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { HeroBand } from "@/components/hero-band";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import {
  HISTORY_BOOKING_STATUSES,
  type RequesterBookingCard,
} from "@/components/requester-booking-list";
import { RequesterHistoryClient } from "@/components/requester-history-client";

// The requester's full request log: everything they have ever asked for, newest
// first — still waiting for approval, approved, out on the road, and finished.
//
// It deliberately overlaps /requester/upcoming, which answers a different
// question ("what is happening next?"). Splitting them by status meant a request
// submitted minutes ago was absent here, so an empty log read as "my request
// vanished". A log that omits the newest entry isn't a log.
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
      select: { id: true, purpose: true, destination: true },
    }),
    prisma.booking.findMany({
      where: { requesterId: session.user.id },
      orderBy: { startAt: "desc" },
      include: { vehicle: true },
    }),
  ]);

  // A past-due booking nobody formally closed out reads as done from the
  // requester's point of view; anything still ahead keeps its real status so a
  // waiting request is plainly still waiting.
  const historyRows: RequesterBookingCard[] = history.map((b) => ({
    id: b.id,
    jobType: b.jobType,
    status:
      (HISTORY_BOOKING_STATUSES as readonly string[]).includes(b.status) || b.endAt >= now
        ? b.status
        : "COMPLETED",
    purpose: b.purpose,
    destination: b.destination,
    province: b.province,
    startAt: b.startAt,
    vehicle: b.vehicle ? { registrationNumber: b.vehicle.registrationNumber } : null,
    hasPdf: !!b.pdfUrl,
  }));

  return (
    <div className="space-y-8">
      {/* No จองใหม่ button here: it is the first item in the header bar on every
          requester page, and this one is a log — a read-only view. */}
      <HeroBand
        title={t("historyTitle")}
        description={t("historyDescription")}
        icon={FileText}
        stats={
          historyRows.length > 0
            ? [
                { label: t("historyTitle"), value: historyRows.length },
                ...(pendingEvalBookings.length > 0
                  ? [
                      {
                        label: t("pendingEvalDescription"),
                        value: pendingEvalBookings.length,
                        tone: "urgent" as const,
                      },
                    ]
                  : []),
              ]
            : undefined
        }
        actions={
          // nativeButton={false}: this renders as an <a>, and Base UI otherwise
          // keeps native button semantics on a link.
          <Button
            size="xl"
            variant="secondary"
            nativeButton={false}
            render={<Link href="/requester/new" />}
          >
            <Plus aria-hidden />
            {t("newBooking")}
          </Button>
        }
      />

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
        <EmptyState
          icon={FileText}
          title={t("historyEmptyTitle")}
          description={t("historyEmptyDescription")}
          action={
            // A brand-new requester's first screen had no way forward on it at
            // all — the only route to filing a request was the nav bar. `action`
            // has existed on EmptyState since it was written and nothing passed it.
            <Button size="xl" nativeButton={false} render={<Link href="/requester/new" />}>
              <Plus aria-hidden />
              {t("newBooking")}
            </Button>
          }
        />
      ) : (
        <RequesterHistoryClient bookings={historyRows} />
      )}
    </div>
  );
}
