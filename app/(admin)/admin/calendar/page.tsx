import Link from "next/link";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  parse,
} from "date-fns";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";

const STATUS_TINT: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/40",
  APPROVED: "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900/40",
  ASSIGNED: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900/40",
  COMPLETED: "bg-muted text-muted-foreground border-border",
  CANCELLED: "bg-muted text-muted-foreground border-border line-through",
  DENIED: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900/40",
};

function parseMonth(s?: string): Date {
  if (!s) return startOfMonth(new Date());
  const d = parse(s, "yyyy-MM", new Date());
  if (Number.isNaN(d.getTime())) return startOfMonth(new Date());
  return startOfMonth(d);
}

export default async function AdminCalendar({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireRole("ADMIN");
  const qs = await searchParams;
  const monthAnchor = parseMonth(qs.month);

  // Show the full weeks that overlap this month — typically 5 or 6 rows.
  const gridStart = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 0 });

  const bookings = await prisma.booking.findMany({
    where: {
      startAt: { gte: gridStart, lte: gridEnd },
      status: { not: "DRAFT" },
    },
    orderBy: { startAt: "asc" },
    include: {
      vehicle: { select: { registrationNumber: true } },
      requester: { select: { name: true, email: true } },
    },
  });

  const byDay = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const key = format(b.startAt, "yyyy-MM-dd");
    const list = byDay.get(key) ?? [];
    list.push(b);
    byDay.set(key, list);
  }

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const prevMonth = format(subMonths(monthAnchor, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthAnchor, 1), "yyyy-MM");
  const today = new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-muted-foreground">{format(monthAnchor, "MMMM yyyy")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/calendar?month=${prevMonth}`}
            className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            ← {format(subMonths(monthAnchor, 1), "MMM")}
          </Link>
          <Link
            href="/admin/calendar"
            className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            This month
          </Link>
          <Link
            href={`/admin/calendar?month=${nextMonth}`}
            className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            {format(addMonths(monthAnchor, 1), "MMM")} →
          </Link>
        </div>
      </div>

      <Legend />

      <div className="rounded-lg border overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-3 py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const items = byDay.get(key) ?? [];
            const inMonth = isSameMonth(day, monthAnchor);
            const isToday = isSameDay(day, today);
            return (
              <div
                key={key}
                className={`min-h-28 border-t border-l p-1.5 ${
                  inMonth ? "" : "bg-muted/30 text-muted-foreground"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs tabular-nums ${
                      isToday
                        ? "rounded-full bg-primary text-primary-foreground px-1.5 py-0.5 font-semibold"
                        : ""
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  {items.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">{items.length}</span>
                  )}
                </div>
                <div className="mt-1 space-y-1">
                  {items.slice(0, 3).map((b) => (
                    <Link
                      key={b.id}
                      href={`/admin/${b.id}`}
                      className={`block rounded border px-1.5 py-0.5 text-[11px] leading-tight hover:opacity-80 ${
                        STATUS_TINT[b.status] ?? ""
                      }`}
                      title={`${b.jobNumber} · ${b.purpose}`}
                    >
                      <div className="font-medium truncate">
                        {format(b.startAt, "HH:mm")}{" "}
                        {b.vehicle?.registrationNumber ?? "—"}
                      </div>
                      <div className="truncate opacity-80">
                        {b.destination}
                      </div>
                    </Link>
                  ))}
                  {items.length > 3 && (
                    <Link
                      href={`/admin/calendar/day/${key}`}
                      className="block text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      +{items.length - 3} more
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const tags: Array<[string, string]> = [
    ["PENDING_APPROVAL", "Pending"],
    ["APPROVED", "Approved"],
    ["ASSIGNED", "Assigned"],
    ["COMPLETED", "Completed"],
    ["CANCELLED", "Cancelled"],
    ["DENIED", "Denied"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {tags.map(([key, label]) => (
        <span key={key} className={`rounded border px-1.5 py-0.5 ${STATUS_TINT[key]}`}>
          {label}
        </span>
      ))}
    </div>
  );
}
