import Link from "next/link";
import { format, startOfDay, endOfDay, addDays } from "date-fns";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { BookingStatusBadge } from "@/components/booking-status-badge";

export default async function DriverHome() {
  const session = await requireRole("DRIVER");
  const driverProfile = await prisma.driver.findUnique({ where: { userId: session.user.id } });
  if (!driverProfile) {
    return <p className="text-sm text-muted-foreground">No driver profile found for your account. Ask the admin to set one up.</p>;
  }
  const driverId = driverProfile.id;

  const now = new Date();
  const driverFilter = {
    OR: [{ primaryDriverId: driverId }, { secondaryDriverId: driverId }],
  };

  const [today, tomorrow] = await Promise.all([
    prisma.booking.findMany({
      where: {
        ...driverFilter,
        status: { in: ["ASSIGNED", "COMPLETED"] },
        startAt: { gte: startOfDay(now), lte: endOfDay(now) },
      },
      orderBy: { startAt: "asc" },
      include: { vehicle: true, requester: true, primaryDriver: { include: { user: true } } },
    }),
    prisma.booking.findMany({
      where: {
        ...driverFilter,
        status: "ASSIGNED",
        startAt: { gte: startOfDay(addDays(now, 1)), lte: endOfDay(addDays(now, 1)) },
      },
      orderBy: { startAt: "asc" },
      include: { vehicle: true, requester: true, primaryDriver: { include: { user: true } } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
        <p className="text-base text-muted-foreground">{format(now, "EEEE d MMMM yyyy")}</p>
      </div>

      <Section title="Today">
        {today.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-base text-muted-foreground">No trips today.</CardContent></Card>
        ) : (
          today.map((b) => <AssignmentCard key={b.id} booking={b} />)
        )}
      </Section>

      <Section title="Tomorrow">
        {tomorrow.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-base text-muted-foreground">Nothing scheduled for tomorrow.</CardContent></Card>
        ) : (
          tomorrow.map((b) => <AssignmentCard key={b.id} booking={b} />)
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

type AssignmentRow = Awaited<ReturnType<typeof loadAssignments>>[number];
async function loadAssignments() {
  return prisma.booking.findMany({
    include: { vehicle: true, requester: true, primaryDriver: { include: { user: true } } },
  });
}

function AssignmentCard({ booking }: { booking: AssignmentRow }) {
  return (
    <Link
      href={`/driver/${booking.id}`}
      className="block rounded-xl border bg-card p-5 hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{booking.jobNumber}</span>
            <BookingStatusBadge status={booking.status} />
          </div>
          <div className="mt-1 text-xl font-semibold">
            {format(booking.startAt, "HH:mm")} → {booking.destination}
          </div>
          <div className="text-base text-muted-foreground">
            {booking.vehicle?.registrationNumber ?? "—"} · {booking.passengerCount} pax
          </div>
          <div className="text-sm text-muted-foreground">
            {booking.requester.name ?? booking.requester.email}
            {booking.requester.phone ? ` · ${booking.requester.phone}` : ""}
          </div>
        </div>
      </div>
    </Link>
  );
}
