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
import { getLocale, getTranslations } from "next-intl/server";
import { th, enUS, type Locale } from "date-fns/locale";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";

const STATUS_TINT: Record<string, string> = {
  PENDING_APPROVAL:
    "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30",
  APPROVED:
    "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-400/30",
  ASSIGNED:
    "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30",
  COMPLETED:
    "bg-muted text-muted-foreground border-border dark:bg-violet-500/10 dark:text-violet-200 dark:border-violet-400/25",
  CANCELLED:
    "bg-muted text-muted-foreground border-border line-through dark:bg-white/5 dark:text-muted-foreground dark:border-white/10",
  DENIED:
    "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30",
};

const LEGEND_KEYS = [
  "PENDING_APPROVAL",
  "APPROVED",
  "ASSIGNED",
  "COMPLETED",
  "CANCELLED",
  "DENIED",
] as const;

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

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
  const t = await getTranslations("calendar");
  const localeCode = await getLocale();
  const loc: Locale = localeCode.toLowerCase().startsWith("th") ? th : enUS;
  const qs = await searchParams;
  const monthAnchor = parseMonth(qs.month);

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
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{format(monthAnchor, "MMMM yyyy", { locale: loc })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/calendar?month=${prevMonth}`}
            className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            ← {format(subMonths(monthAnchor, 1), "MMM", { locale: loc })}
          </Link>
          <Link
            href="/admin/calendar"
            className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            {t("thisMonth")}
          </Link>
          <Link
            href={`/admin/calendar?month=${nextMonth}`}
            className="rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            {format(addMonths(monthAnchor, 1), "MMM", { locale: loc })} →
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {LEGEND_KEYS.map((key) => (
          <span key={key} className={`rounded border px-1.5 py-0.5 ${STATUS_TINT[key]}`}>
            {t(`legend.${key}`)}
          </span>
        ))}
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          {WEEKDAY_KEYS.map((k) => (
            <div key={k} className="px-3 py-2">{t(`weekdayHeaders.${k}`)}</div>
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
                className={`min-h-20 border-t border-l p-1 ${
                  inMonth
                    ? "bg-card"
                    : "bg-muted/40 text-muted-foreground/70 dark:bg-white/[0.02] dark:text-muted-foreground/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={
                      isToday
                        ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold tabular-nums"
                        : "text-xs tabular-nums px-1"
                    }
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
                      {t("more", { n: items.length - 3 })}
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
