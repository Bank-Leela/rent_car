import Link from "next/link";
import type { JobType, Prisma } from "@prisma/client";
import { format, startOfDay, subHours } from "date-fns";
import { ClipboardCheck, ListOrdered, CalendarClock, ChevronRight, UserCheck, Users, Zap, AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { InChulaChip } from "@/components/in-chula-chip";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { OnCallShiftForm } from "@/components/forms/matching-form";
import { ApproverQueueActions } from "@/components/forms/approver-queue-actions";
import { QueueFilterBar } from "@/components/admin/queue-filter-bar";
import { parseQueueSort } from "@/lib/admin/queue-sort";
import { QueueBulkProvider, BulkCheckbox } from "@/components/admin/queue-bulk";
import { OtAssignButton } from "@/components/admin/ot-assign-button";
import { JOB_COLOR } from "@/components/admin/scheduler-board-shared";
import { loadQueueContext } from "@/lib/booking/queue-context";
import { waitingHours, SLA_WARN_HOURS, type TriageFlag } from "@/lib/booking/triage";
import { Section } from "@/components/section";

const JOB_TYPES: JobType[] = ["NORMAL", "OT", "TJW", "WERN", "SMUS"];
const PENDING_DEFAULT_LIMIT = 100;
const PENDING_MAX_LIMIT = 500;

export default async function AdminQueue({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; jobType?: string; overdue?: string; sort?: string; limit?: string }>;
}) {
  const session = await requireAnyRole(["ADMIN"]);
  const isAdmin = session.user.roles.includes("ADMIN");
  const t = await getTranslations("admin");
  const tAuto = await getTranslations("matching");
  const now = new Date();
  const today = startOfDay(now);
  const urgentLabel = (await getTranslations("bookingForm"))("urgentBadge");

  // Free-text filter across the three lists (job number / purpose / destination
  // / requester / department) — the daily "find that one booking" need.
  const sp = await searchParams;
  const term = (sp.q ?? "").trim();
  const searchFilter: Prisma.BookingWhereInput = term
    ? {
        OR: [
          { jobNumber: { contains: term, mode: "insensitive" } },
          { purpose: { contains: term, mode: "insensitive" } },
          { destination: { contains: term, mode: "insensitive" } },
          { requester: { name: { contains: term, mode: "insensitive" } } },
          { department: { nameEn: { contains: term, mode: "insensitive" } } },
        ],
      }
    : {};

  // Faceted pending-queue filters (URL-persisted via QueueFilterBar): job type,
  // "overdue only" (waiting past the SLA), sort, and a hard cap so a runaway
  // backlog can't load unbounded rows.
  const jobTypeFilter = (sp.jobType ?? "").split(",").filter((x): x is JobType => (JOB_TYPES as string[]).includes(x));
  const overdueOnly = sp.overdue === "1";
  const sort = parseQueueSort(sp.sort);
  const pendingLimit = Math.min(Math.max(parseInt(sp.limit ?? "", 10) || PENDING_DEFAULT_LIMIT, 1), PENDING_MAX_LIMIT);
  const pendingFilter: Prisma.BookingWhereInput = {
    ...(jobTypeFilter.length ? { jobType: { in: jobTypeFilter } } : {}),
    ...(overdueOnly ? { createdAt: { lte: subHours(now, SLA_WARN_HOURS) } } : {}),
  };

  // Shared console for ADMIN + APPROVER. Both see the full pipeline; the
  // detail page surfaces role-appropriate action forms.
  const [pending, approved, upcoming, todayShift, allDrivers] = await Promise.all([
    prisma.booking.findMany({
      // P'Top's decision queue: normal pending plus over-capacity WAITLIST
      // cases (the 11th+ booking of a day) for him to fit or deny.
      where: { status: { in: ["PENDING_APPROVAL", "WAITLIST"] }, ...searchFilter, ...pendingFilter },
      orderBy: sort === "oldest" ? { createdAt: "asc" } : { startAt: "asc" },
      take: pendingLimit,
      include: { requester: true, department: true },
    }),
    prisma.booking.findMany({
      where: { status: "APPROVED", ...searchFilter },
      orderBy: { createdAt: "asc" },
      take: 50, // bounded — the awaiting-assignment log shouldn't grow without limit
      include: { requester: true, department: true },
    }),
    prisma.booking.findMany({
      where: { status: "ASSIGNED", endAt: { gte: new Date() }, ...searchFilter },
      orderBy: { startAt: "asc" },
      take: 20,
      include: { vehicle: true, primaryDriver: { include: { user: true } } },
    }),
    prisma.onCallShift.findUnique({
      where: { date: today },
      include: { driver: { include: { user: true } } },
    }),
    prisma.driver.findMany({
      where: { isActive: true },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const driversForPicker = allDrivers.map((d) => ({
    id: d.id,
    name: d.user.name ?? d.user.email ?? d.id,
  }));
  const todayIso = format(today, "yyyy-MM-dd");
  const todayOnCallName =
    todayShift?.driver.user.name ?? todayShift?.driver.user.email ?? null;

  // Overtime placement recos (over-capacity WAITLIST), per-booking triage flags,
  // and the SLA-overdue count — see lib/booking/queue-context.
  const { overtimeReco, triageByBooking, slaOverdue } = await loadQueueContext({
    pending,
    allDrivers,
    now,
  });

  // Waitlist gets its own over-capacity section; "risk" sort uses the triage
  // flags just computed (more flags first, then longest-waiting).
  const waitlistRows = pending.filter((b) => b.status === "WAITLIST");
  let pendingRows = pending.filter((b) => b.status === "PENDING_APPROVAL");
  if (sort === "risk") {
    pendingRows = [...pendingRows].sort((a, z) => {
      const fa = triageByBooking.get(a.id)?.length ?? 0;
      const fz = triageByBooking.get(z.id)?.length ?? 0;
      if (fz !== fa) return fz - fa;
      return waitingHours(z.createdAt, now) - waitingHours(a.createdAt, now);
    });
  }
  const showMoreHref = (() => {
    const q = new URLSearchParams();
    if (term) q.set("q", term);
    if (sp.jobType) q.set("jobType", sp.jobType);
    if (overdueOnly) q.set("overdue", "1");
    if (sp.sort) q.set("sort", sp.sort);
    q.set("limit", String(Math.min(pendingLimit + PENDING_DEFAULT_LIMIT, PENDING_MAX_LIMIT)));
    return `/admin?${q.toString()}`;
  })();

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("description", { count: approved.length })}
      />

      <form action="/admin" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={term}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="h-10 w-full max-w-xs rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {t("search")}
        </button>
        {term && (
          <Link
            href="/admin"
            className="inline-flex h-10 items-center rounded-md border px-4 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("clear")}
          </Link>
        )}
      </form>

      {slaOverdue > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {t("slaWaiting", { count: slaOverdue })}
        </div>
      )}

      {isAdmin && (
        <Section title={tAuto("onCallSectionHeading")} icon={<UserCheck className="h-4 w-4" />}>
          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
            <p className="text-sm text-muted-foreground">
              {todayOnCallName
                ? tAuto("todayIs", { name: todayOnCallName, date: todayIso })
                : tAuto("notSetForToday", { date: todayIso })}
            </p>
            <OnCallShiftForm
              date={todayIso}
              defaultDriverId={todayShift?.driverId ?? null}
              drivers={driversForPicker}
            />
          </div>
        </Section>
      )}

      <Section title={t("pendingHeading")} icon={<ClipboardCheck className="h-4 w-4" />}>
        <div className="mb-3">
          <QueueFilterBar />
        </div>
        {pendingRows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={t("pendingEmptyTitle")}
            description={t("pendingEmptyDescription")}
          />
        ) : (
          <QueueBulkProvider>
            <ul className="space-y-2">
              {pendingRows.map((b) => (
                <li key={b.id}>
                  <div className="rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex items-start gap-2">
                      <BulkCheckbox bookingId={b.id} />
                      <Link
                        href={`/admin/${b.id}`}
                        className="group -m-1 flex min-w-0 flex-1 items-start justify-between gap-4 rounded-lg p-1 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                            <BookingStatusBadge status={b.status} />
                            <InChulaChip outsideChula={b.outsideChula} />
                            {b.isEmergency && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                                {urgentLabel}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 font-medium truncate">{b.purpose}</div>
                          <div className="mt-0.5 text-sm text-muted-foreground">
                            {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM HH:mm")} → {format(b.endAt, "EEE d MMM HH:mm")}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {b.requester.name ?? b.requester.email} · {b.department.nameEn}
                          </div>
                          <QueueInfoRow
                            jobType={b.jobType}
                            paxLabel={t("paxCount", { count: b.passengerCount })}
                            estimatedDistance={b.estimatedDistance}
                            needsSecondaryDriver={b.needsSecondaryDriver}
                            submitted={t("submittedAt", { date: format(b.createdAt, "d MMM HH:mm") })}
                            coDriverLabel={t("coDriverNeeded")}
                          />
                          <TriageChips flags={triageByBooking.get(b.id) ?? []} waitedHours={waitingHours(b.createdAt, now)} t={t} />
                        </div>
                        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </div>
                    {isAdmin && <ApproverQueueActions bookingId={b.id} canDeny />}
                  </div>
                </li>
              ))}
            </ul>
          </QueueBulkProvider>
        )}
        {pending.length >= pendingLimit && pendingLimit < PENDING_MAX_LIMIT && (
          <div className="mt-3">
            <Link href={showMoreHref} className="text-sm text-primary underline-offset-2 hover:underline">
              {t("showMore")}
            </Link>
          </div>
        )}
      </Section>

      {waitlistRows.length > 0 && (
        <Section title={t("waitlistHeading")} icon={<Zap className="h-4 w-4" />}>
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
            <Zap className="h-4 w-4 shrink-0" aria-hidden />
            {t("waitlistBanner")}
          </div>
          <ul className="space-y-2">
            {waitlistRows.map((b) => (
              <li key={b.id}>
                <div className="rounded-xl border border-amber-200 bg-card p-4 shadow-sm dark:border-amber-900/40">
                  <Link
                    href={`/admin/${b.id}`}
                    className="group -m-1 flex items-start justify-between gap-4 rounded-lg p-1 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                        <BookingStatusBadge status={b.status} />
                        <InChulaChip outsideChula={b.outsideChula} />
                        {b.isEmergency && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                            {urgentLabel}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 font-medium truncate">{b.purpose}</div>
                      <div className="mt-0.5 text-sm text-muted-foreground">
                        {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM HH:mm")} → {format(b.endAt, "EEE d MMM HH:mm")}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {b.requester.name ?? b.requester.email} · {b.department.nameEn}
                      </div>
                      <QueueInfoRow
                        jobType={b.jobType}
                        paxLabel={t("paxCount", { count: b.passengerCount })}
                        estimatedDistance={b.estimatedDistance}
                        needsSecondaryDriver={b.needsSecondaryDriver}
                        submitted={t("submittedAt", { date: format(b.createdAt, "d MMM HH:mm") })}
                        coDriverLabel={t("coDriverNeeded")}
                      />
                      <TriageChips flags={triageByBooking.get(b.id) ?? []} waitedHours={waitingHours(b.createdAt, now)} t={t} />
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  {overtimeReco.has(b.id) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                        <Zap className="h-3.5 w-3.5 shrink-0" />
                        {t("overtimeFit", {
                          name: overtimeReco.get(b.id)!.name,
                          reg: overtimeReco.get(b.id)!.reg,
                          time: overtimeReco.get(b.id)!.time,
                        })}
                      </span>
                      {isAdmin && (
                        <OtAssignButton
                          bookingId={b.id}
                          vehicleId={overtimeReco.get(b.id)!.vehicleId}
                          summary={`${overtimeReco.get(b.id)!.name} · ${overtimeReco.get(b.id)!.reg} · ${overtimeReco.get(b.id)!.time}`}
                        />
                      )}
                    </div>
                  )}
                  {isAdmin && <ApproverQueueActions bookingId={b.id} canDeny={false} />}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("queueLogHeading")} icon={<ListOrdered className="h-4 w-4" />}>
        {approved.length === 0 ? (
          <EmptyState
            icon={ListOrdered}
            title={t("queueEmptyTitle")}
            description={t("queueEmptyDescription")}
          />
        ) : (
          <ol className="space-y-2">
            {approved.map((b, i) => (
              <li key={b.id}>
                <Link
                  href={`/admin/${b.id}`}
                  className="group flex items-start gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-mono text-muted-foreground"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                      <BookingStatusBadge status={b.status} />
                      {b.isEmergency && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                          {urgentLabel}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-medium truncate">{b.purpose}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM HH:mm")} → {format(b.endAt, "EEE d MMM HH:mm")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {b.requester.name ?? b.requester.email} · {b.department.nameEn} ·{" "}
                      {t("submittedAt", { date: format(b.createdAt, "d MMM HH:mm") })}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={t("upcomingTrips")} icon={<CalendarClock className="h-4 w-4" />}>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={t("upcomingEmptyTitle")}
            description={t("upcomingEmptyDescription")}
          />
        ) : (
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/admin/${b.id}`}
                  className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                      <BookingStatusBadge status={b.status} />
                      {b.isEmergency && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                          {urgentLabel}
                        </span>
                      )}
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

type AdminT = Awaited<ReturnType<typeof getTranslations<"admin">>>;

// Compact fact row so P'Top can triage without opening the detail page:
// job-type dot, passenger count, distance (when meaningful), a co-driver-needed
// marker (flagged or >400 km), and when the request was submitted.
function QueueInfoRow({
  jobType,
  paxLabel,
  estimatedDistance,
  needsSecondaryDriver,
  submitted,
  coDriverLabel,
}: {
  jobType: string;
  paxLabel: string;
  estimatedDistance: number | null;
  needsSecondaryDriver: boolean;
  submitted: string;
  coDriverLabel: string;
}) {
  const color = JOB_COLOR[jobType];
  const needsCoDriver = needsSecondaryDriver || (estimatedDistance ?? 0) > 400;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        {color && <span aria-hidden className={`h-2 w-2 rounded-full ${color.dot}`} />}
        {jobType}
      </span>
      <span>{paxLabel}</span>
      {estimatedDistance != null && <span>~{estimatedDistance} km</span>}
      {needsCoDriver && (
        <span className="inline-flex items-center gap-1 font-medium text-violet-700 dark:text-violet-400">
          <Users className="h-3.5 w-3.5" aria-hidden />
          {coDriverLabel}
        </span>
      )}
      <span>{submitted}</span>
    </div>
  );
}

function Pill({ tone, children }: { tone: "amber" | "rose"; children: string }) {
  const cls =
    tone === "rose"
      ? "bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-300"
      : "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

// Risk/capacity/aging chips for one pending request. Aging shows after 12h
// (amber), escalating to rose past 48h; per-flag tone marks the urgent ones.
function TriageChips({ flags, waitedHours, t }: { flags: TriageFlag[]; waitedHours: number; t: AdminT }) {
  const showAging = waitedHours >= 12;
  if (flags.length === 0 && !showAging) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {flags.map((f, i) => {
        const tone: "amber" | "rose" = f.key === "emergency" || f.key === "dayFull" ? "rose" : "amber";
        const label =
          f.key === "dayFull"
            ? t("triageDayFull", { used: f.used, capacity: f.capacity })
            : f.key === "repeatCanceller"
              ? t("triageRepeatCanceller", { count: f.count })
              : f.key === "outOfHours"
                ? t("triageOutOfHours")
                : f.key === "shortLead"
                  ? t("triageShortLead")
                  : t("triageEmergency");
        return (
          <Pill key={i} tone={tone}>
            {label}
          </Pill>
        );
      })}
      {showAging && (
        <Pill tone={waitedHours >= SLA_WARN_HOURS * 2 ? "rose" : "amber"}>
          {waitedHours >= 24
            ? t("triageWaitingDays", { days: Math.floor(waitedHours / 24) })
            : t("triageWaitingHours", { hours: waitedHours })}
        </Pill>
      )}
    </div>
  );
}
