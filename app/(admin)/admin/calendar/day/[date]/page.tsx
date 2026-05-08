import { notFound } from "next/navigation";
import Link from "next/link";
import { format, parse, startOfDay, endOfDay } from "date-fns";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";

export default async function CalendarDay({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  await requireRole("ADMIN");
  const { date } = await params;
  const day = parse(date, "yyyy-MM-dd", new Date());
  if (Number.isNaN(day.getTime())) notFound();

  const bookings = await prisma.booking.findMany({
    where: {
      startAt: { gte: startOfDay(day), lte: endOfDay(day) },
      status: { not: "DRAFT" },
    },
    orderBy: { startAt: "asc" },
    include: {
      vehicle: { select: { registrationNumber: true } },
      requester: { select: { name: true, email: true } },
      department: { select: { nameEn: true } },
      primaryDriver: { include: { user: { select: { name: true, email: true } } } },
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{format(day, "EEEE d MMMM yyyy")}</h1>
          <p className="text-muted-foreground">{bookings.length} booking{bookings.length === 1 ? "" : "s"}</p>
        </div>
        <Link
          href={`/admin/calendar?month=${format(day, "yyyy-MM")}`}
          className="inline-flex items-center justify-center rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          Back to month
        </Link>
      </div>

      {bookings.length === 0 ? (
        <p className="rounded-md border bg-card py-8 text-center text-sm text-muted-foreground">
          Nothing scheduled.
        </p>
      ) : (
        <div className="space-y-2">
          {bookings.map((b) => (
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
                    {format(b.startAt, "HH:mm")} → {format(b.endAt, "HH:mm")} ·{" "}
                    {b.destination}
                    {b.vehicle ? ` · ${b.vehicle.registrationNumber}` : ""}
                    {b.primaryDriver
                      ? ` · ${b.primaryDriver.user.name ?? b.primaryDriver.user.email}`
                      : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {b.requester.name ?? b.requester.email} · {b.department.nameEn}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
