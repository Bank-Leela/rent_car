import Link from "next/link";
import { format } from "date-fns";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { BookingStatusBadge } from "@/components/booking-status-badge";

export default async function AdminQueue() {
  await requireRole("ADMIN");

  // Phase 2: admin sees only bookings that have cleared department-head approval.
  // FCFS per plan §5.6 — order by createdAt asc, no admin override.
  const pending = await prisma.booking.findMany({
    where: { status: "APPROVED" },
    orderBy: { createdAt: "asc" },
    include: {
      requester: true,
      department: true,
    },
  });

  const upcoming = await prisma.booking.findMany({
    where: { status: "ASSIGNED", endAt: { gte: new Date() } },
    orderBy: { startAt: "asc" },
    take: 20,
    include: { vehicle: true, primaryDriver: { include: { user: true } } },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Booking queue</h1>
        <p className="text-muted-foreground">
          First-come-first-served. {pending.length} awaiting assignment.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Awaiting assignment
        </h2>
        {pending.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Queue is empty.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pending.map((b) => (
              <Link
                key={b.id}
                href={`/admin/${b.id}`}
                className="block rounded-lg border bg-card p-4 hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-muted-foreground">{b.jobNumber}</span>
                      <BookingStatusBadge status={b.status} />
                    </div>
                    <div className="mt-1 font-medium">{b.purpose}</div>
                    <div className="text-sm text-muted-foreground">
                      {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM HH:mm")} → {format(b.endAt, "EEE d MMM HH:mm")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {b.requester.name ?? b.requester.email} · {b.department.nameEn} · submitted {format(b.createdAt, "d MMM HH:mm")}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Upcoming assigned trips
        </h2>
        {upcoming.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nothing scheduled.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {upcoming.map((b) => (
              <Link
                key={b.id}
                href={`/admin/${b.id}`}
                className="block rounded-lg border bg-card p-4 hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-muted-foreground">{b.jobNumber}</span>
                      <BookingStatusBadge status={b.status} />
                    </div>
                    <div className="mt-1 font-medium">{b.purpose}</div>
                    <div className="text-sm text-muted-foreground">
                      {format(b.startAt, "EEE d MMM HH:mm")} ·{" "}
                      {b.vehicle?.registrationNumber ?? "—"} ·{" "}
                      {b.primaryDriver?.user.name ?? b.primaryDriver?.user.email ?? "—"}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
