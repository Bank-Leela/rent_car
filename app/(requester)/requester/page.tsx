import Link from "next/link";
import { format } from "date-fns";
import { Plus, FileText, ChevronRight, Star } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default async function RequesterHome() {
  const session = await requireRole("REQUESTER");
  const t = await getTranslations("requester");
  const [bookings, pendingEvalBookings] = await Promise.all([
    prisma.booking.findMany({
      where: { requesterId: session.user.id },
      orderBy: { createdAt: "desc" },
      include: { vehicle: true },
    }),
    prisma.booking.findMany({
      where: {
        requesterId: session.user.id,
        status: "COMPLETED",
        trip: { is: { evaluation: null } },
      },
      select: { id: true, jobNumber: true, purpose: true, destination: true },
    }),
  ]);

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
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={newBookingButton}
      />

      {pendingEvalBookings.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              <Star className="h-5 w-5" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {t("pendingEvalTitle", { count: pendingEvalBookings.length })}
              </h2>
              <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-300/90">
                {t("pendingEvalDescription")}
              </p>
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

      {bookings.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={newBookingButton}
        />
      ) : (
        <ul className="space-y-2">
          {bookings.map((b) => (
            <li key={b.id}>
              <Link
                href={`/requester/${b.id}`}
                className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                    <BookingStatusBadge status={b.status} />
                  </div>
                  <div className="mt-1 font-medium truncate">{b.purpose}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM yyyy HH:mm")}
                    {b.vehicle ? ` · ${b.vehicle.registrationNumber}` : ""}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
