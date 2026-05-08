import Link from "next/link";
import { format } from "date-fns";
import { Inbox, CalendarClock, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default async function AdminQueue() {
  await requireRole("ADMIN");

  // Phase 2: admin sees only bookings that have cleared department-head approval.
  // FCFS per plan §5.6 — order by createdAt asc, no admin override.
  const pending = await prisma.booking.findMany({
    where: { status: "APPROVED" },
    orderBy: { createdAt: "asc" },
    include: { requester: true, department: true },
  });

  const upcoming = await prisma.booking.findMany({
    where: { status: "ASSIGNED", endAt: { gte: new Date() } },
    orderBy: { startAt: "asc" },
    take: 20,
    include: { vehicle: true, primaryDriver: { include: { user: true } } },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Booking queue"
        description={`First-come-first-served. ${pending.length} awaiting assignment.`}
      />

      <Section title="Awaiting assignment" icon={<Inbox className="h-4 w-4" />}>
        {pending.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Queue is empty"
            description="Approved bookings will appear here, oldest first."
          />
        ) : (
          <ul className="space-y-2">
            {pending.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/admin/${b.id}`}
                  className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                      <BookingStatusBadge status={b.status} />
                    </div>
                    <div className="mt-1 font-medium truncate">{b.purpose}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM HH:mm")} → {format(b.endAt, "EEE d MMM HH:mm")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {b.requester.name ?? b.requester.email} · {b.department.nameEn} · submitted {format(b.createdAt, "d MMM HH:mm")}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Upcoming assigned trips" icon={<CalendarClock className="h-4 w-4" />}>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nothing scheduled"
            description="Once you assign vehicles, the next 20 trips will show up here."
          />
        ) : (
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/admin/${b.id}`}
                  className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                      <BookingStatusBadge status={b.status} />
                    </div>
                    <div className="mt-1 font-medium truncate">{b.purpose}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {format(b.startAt, "EEE d MMM HH:mm")} ·{" "}
                      {b.vehicle?.registrationNumber ?? "—"} ·{" "}
                      {b.primaryDriver?.user.name ?? b.primaryDriver?.user.email ?? "—"}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}
