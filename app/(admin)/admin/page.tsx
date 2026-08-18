import Link from "next/link";
import type { JobType, Prisma } from "@prisma/client";
import { format, subHours } from "date-fns";
import { tripWhen, tripWhenRecurring } from "@/lib/booking/trip-when";
import { ClipboardCheck, CalendarClock, ChevronRight, Zap, AlertTriangle, FileClock, Bus, Inbox } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { InChulaChip } from "@/components/in-chula-chip";
import { JobTypeChip } from "@/components/job-type-chip";
import { HeroBand } from "@/components/hero-band";
import { EmptyState } from "@/components/empty-state";
import { ApproverQueueActions } from "@/components/forms/approver-queue-actions";
import { SeriesQueueActions } from "@/components/forms/series-queue-actions";
import { QueueFilterBar } from "@/components/admin/queue-filter-bar";
import { parseQueueSort } from "@/lib/admin/queue-sort";
import { QueueBulkProvider, BulkCheckbox } from "@/components/admin/queue-bulk";
import { OtAssignButton } from "@/components/admin/ot-assign-button";
import { loadQueueContext } from "@/lib/booking/queue-context";
import { waitingHours, SLA_WARN_HOURS, type TriageFlag } from "@/lib/booking/triage";
import { Section } from "@/components/section";
import { formatTh } from "@/lib/format-date";
import { groupBySeries } from "@/lib/booking/series";
import { QUEUE_JOB_TYPES } from "@/lib/admin/queue-job-types";
import { BookingDocumentLink } from "@/components/booking-document-link";
import { DocumentApproveButton } from "@/components/admin/document-approve-button";

// Five cards, then "แสดงเพิ่ม" adds five more. A hundred approve/deny cards at
// once is a wall, not a queue — and each carries its own controls, so the page
// was rendering far more interactive markup than anyone works through in a
// sitting. The show-more link raises the limit by this same step.
const PENDING_DEFAULT_LIMIT = 5;
const PENDING_MAX_LIMIT = 500;

export default async function AdminQueue({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; jobType?: string; overdue?: string; sort?: string;
    limit?: string; docLimit?: string; tripLimit?: string;
  }>;
}) {
  const session = await requireAnyRole(["ADMIN"]);
  const isAdmin = session.user.roles.includes("ADMIN");
  const t = await getTranslations("admin");
  const now = new Date();
  const urgentLabel = (await getTranslations("bookingForm"))("urgentBadge");
  const ta = await getTranslations("approverActions");

  // Free-text filter across the three lists (ชื่อการจอง / destination /
  // requester / department) — the daily "find that one booking" need.
  const sp = await searchParams;
  const term = (sp.q ?? "").trim();
  const searchFilter: Prisma.BookingWhereInput = term
    ? {
        OR: [
          { purpose: { contains: term, mode: "insensitive" } },
          { destination: { contains: term, mode: "insensitive" } },
          { requester: { name: { contains: term, mode: "insensitive" } } },
          { department: { nameTh: { contains: term, mode: "insensitive" } } },
        ],
      }
    : {};

  // Faceted pending-queue filters (URL-persisted via QueueFilterBar): job type,
  // "overdue only" (waiting past the SLA), sort, and a hard cap so a runaway
  // backlog can't load unbounded rows.
  const jobTypeFilter = (sp.jobType ?? "").split(",").filter((x): x is JobType => (QUEUE_JOB_TYPES as string[]).includes(x));
  const overdueOnly = sp.overdue === "1";
  const sort = parseQueueSort(sp.sort);
  const pendingLimit = Math.min(Math.max(parseInt(sp.limit ?? "", 10) || PENDING_DEFAULT_LIMIT, 1), PENDING_MAX_LIMIT);
  // Same five-then-more rule for the other two lists. Each keeps its own param so
  // expanding one section does not silently expand the rest.
  const readLimit = (raw: string | undefined) =>
    Math.min(Math.max(parseInt(raw ?? "", 10) || PENDING_DEFAULT_LIMIT, 1), PENDING_MAX_LIMIT);
  const docLimit = readLimit(sp.docLimit);
  const tripLimit = readLimit(sp.tripLimit);
  const pendingFilter: Prisma.BookingWhereInput = {
    ...(jobTypeFilter.length ? { jobType: { in: jobTypeFilter } } : {}),
    ...(overdueOnly ? { createdAt: { lte: subHours(now, SLA_WARN_HOURS) } } : {}),
  };

  // Counts for the filter panel, so each option says how many rows it would
  // leave BEFORE you spend a click on it. Faceted: the job-type counts obey the
  // overdue toggle and the search, but not the job-type selection itself —
  // counting a facet against itself would show (0) beside the box you just
  // ticked. Two cheap grouped aggregates, not a second fetch of the rows.
  const queueScope: Prisma.BookingWhereInput = {
    status: { in: ["PENDING_APPROVAL", "WAITLIST"] },
    ...searchFilter,
  };
  const overdueWhere = { createdAt: { lte: subHours(now, SLA_WARN_HOURS) } };
  const [jobTypeGroups, overdueCount] = await Promise.all([
    prisma.booking.groupBy({
      by: ["jobType"],
      where: { ...queueScope, ...(overdueOnly ? overdueWhere : {}) },
      _count: { _all: true },
    }),
    prisma.booking.count({
      where: {
        ...queueScope,
        ...overdueWhere,
        ...(jobTypeFilter.length ? { jobType: { in: jobTypeFilter } } : {}),
      },
    }),
  ]);
  const queueCounts = {
    jobType: Object.fromEntries(jobTypeGroups.map((g) => [g.jobType, g._count._all])) as Record<
      string,
      number
    >,
    overdue: overdueCount,
  };

  // Shared console for ADMIN + APPROVER. Both see the full pipeline; the
  // detail page surfaces role-appropriate action forms.
  const [pending, awaitingDoc, approved, upcoming, outsourcedNoVendor, allDrivers] = await Promise.all([
    prisma.booking.findMany({
      // P'Top's decision queue: normal pending plus over-capacity WAITLIST
      // cases (the 11th+ booking of a day) for him to fit or deny.
      where: { status: { in: ["PENDING_APPROVAL", "WAITLIST"] }, ...searchFilter, ...pendingFilter },
      orderBy: sort === "oldest" ? { createdAt: "asc" } : { startAt: "asc" },
      take: PENDING_MAX_LIMIT,
      include: { requester: true, department: true, recurrenceChildren: { select: { id: true } } },
    }),
    prisma.booking.findMany({
      // Approved, waiting on the signed official form. Nothing here has a car
      // yet and nothing will get one until an ADMIN confirms the document, so
      // this list is the actual bottleneck between approval and dispatch.
      where: { status: "AWAITING_DOCUMENT", ...searchFilter },
      orderBy: { startAt: "asc" },
      take: PENDING_MAX_LIMIT,
      include: { requester: true, department: true },
    }),
    prisma.booking.findMany({
      // Only the COUNT and the earliest day are used now (the รอจัดรถ list moved
      // to each day's board), so order by startAt and select just what that needs.
      // Still ahead only. Without the endAt bound this counted every unplaced
      // booking ever, so the banner reported days long past as outstanding work
      // and its link led to a date nobody can act on.
      where: { status: "APPROVED", primaryDriverId: null, endAt: { gte: now }, ...searchFilter },
      orderBy: { startAt: "asc" },
      take: 200,
      select: { id: true, startAt: true },
    }),
    prisma.booking.findMany({
      where: { status: "ASSIGNED", endAt: { gte: new Date() }, ...searchFilter },
      orderBy: { startAt: "asc" },
      take: PENDING_MAX_LIMIT,
      include: { vehicle: true, primaryDriver: { include: { user: true } } },
    }),
    // Approved onto an outside rental, but no vendor row picked yet.
    //
    // Nothing used to list these. Approving a full day whose requester accepted
    // an outside vehicle sets status OUTSOURCED with adHocVehicleId still null,
    // and EVERY admin surface filters it out: the queues key on
    // PENDING_APPROVAL / AWAITING_DOCUMENT / APPROVED / ASSIGNED, and both board
    // views reach outsourced trips only THROUGH an AdHocVehicle row
    // (timeline-board-data.ts requires `adHocVehicleId: { not: null }`). So the
    // trip vanished from the office's side while still showing in the
    // requester's list — they think a vehicle is coming and nobody is hiring one.
    prisma.booking.findMany({
      where: {
        status: "OUTSOURCED",
        adHocVehicleId: null,
        endAt: { gte: new Date() },
        ...searchFilter,
      },
      orderBy: { startAt: "asc" },
      take: PENDING_MAX_LIMIT,
      include: { requester: true, department: true },
    }),
    prisma.driver.findMany({
      where: { isActive: true },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

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
  // A recurring booking is one row PER OCCURRENCE, and a card is a SERIES — so
  // grouping happens before slicing. Doing it the other way round let a single
  // five-week booking consume an entire five-card page.
  //
  // A series of one is just a booking and renders as a normal card; grouping
  // something that is not a group only adds a layer to read past.
  const allPendingGroups = groupBySeries(pendingRows);
  const pendingGroups = allPendingGroups.slice(0, pendingLimit);
  const allDocGroups = groupBySeries(awaitingDoc);
  const docGroups = allDocGroups.slice(0, docLimit);
  const allTripGroups = groupBySeries(upcoming);
  const tripGroups = allTripGroups.slice(0, tripLimit);

  // One builder for all three lists: carry every current param, then raise the
  // one being expanded. Expanding a section must not reset the filters or
  // collapse the others.
  const moreHref = (key: "limit" | "docLimit" | "tripLimit", current: number) => {
    const q = new URLSearchParams();
    if (term) q.set("q", term);
    if (sp.jobType) q.set("jobType", sp.jobType);
    if (overdueOnly) q.set("overdue", "1");
    if (sp.sort) q.set("sort", sp.sort);
    if (sp.limit && key !== "limit") q.set("limit", sp.limit);
    if (sp.docLimit && key !== "docLimit") q.set("docLimit", sp.docLimit);
    if (sp.tripLimit && key !== "tripLimit") q.set("tripLimit", sp.tripLimit);
    q.set(key, String(Math.min(current + PENDING_DEFAULT_LIMIT, PENDING_MAX_LIMIT)));
    return `/admin?${q.toString()}`;
  };
  const showMoreHref = moreHref("limit", pendingLimit);

  return (
    <div className="space-y-8">
      {/* The band the requester pages open with, now on the queue too — this is
          the page P'Top has open all day and it began with a bare heading on flat
          ground. The stats are the ones the sections below are already counting,
          surfaced before you scroll: the whole point of a landing page is
          answering "how much is waiting for me" without reading it. `urgent` only
          when the number is non-zero, so a quiet day stays quiet. */}
      <HeroBand
        title={t("title")}
        description={t("description", { count: approved.length })}
        icon={Inbox}
        stats={[
          { label: t("heroPending"), value: allPendingGroups.length },
          {
            label: t("heroWaitlist"),
            value: waitlistRows.length,
            tone: waitlistRows.length > 0 ? "urgent" : "default",
          },
          // Groups, not rows — the same unit as รออนุมัติ beside it. The section
          // below renders one card per SERIES (a 24-day recurring booking is one
          // decision, not 24), so counting rows here would print "24" over a list
          // showing a single card.
          { label: t("heroAwaitingDoc"), value: allDocGroups.length },
          {
            label: t("heroOverdue"),
            value: slaOverdue,
            tone: slaOverdue > 0 ? "urgent" : "good",
          },
        ]}
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

      {/* The คนขับเวรประจำวัน picker and its "fill 30 days ahead" button lived
          here. The roster now extends itself (`duty-roster.ts`) whenever a day is
          opened, so there was nothing left to press; who is on เวร reads off the
          board's tinted row. */}

      {/* id: the header bell links here. */}
      <Section id="pending" title={t("pendingHeading")} icon={<ClipboardCheck className="h-4 w-4" />}>
        <QueueBulkProvider filters={<QueueFilterBar counts={queueCounts} />} showToolbar={pendingRows.length > 0}>
        {pendingRows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={t("pendingEmptyTitle")}
            description={t("pendingEmptyDescription")}
          />
        ) : (
            <ul className="space-y-2">
              {pendingGroups.map((g) => {
                const b = g.items[0]!;              // the earliest occurrence carries the card
                const isSeries = g.items.length > 1;
                return (
                <li key={g.key}>
                  <div className="rounded-xl border bg-card p-4">
                    <div className="flex items-start gap-2">
                      <BulkCheckbox bookingId={b.id} />
                      <Link
                        href={`/admin/${b.id}`}
                        className="group -m-1 flex min-w-0 flex-1 items-start justify-between gap-4 rounded-lg p-1 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        {/* Quiet by default: title, one when/where line, who.
                            The section header already says these are pending, so
                            the status badge is dropped; job number, department,
                            pax/distance and the submitted timestamp live on the
                            detail page. Only EXCEPTION chips stay — they are what
                            actually decides approve vs deny. */}
                        {/* Gestalt proximity: the trip's identity (what/where/when
                            /who) sits as one tight block, then a wider gap before
                            the exception chips — so "is anything wrong with this
                            one?" reads as a separate glance, not a fifth text row. */}
                        <div className="min-w-0">
                          <div className="space-y-0.5">
                            <div className="truncate font-medium">{b.purpose}</div>
                            <div className="truncate text-sm text-muted-foreground">
                              {b.destination} · {(isSeries ? tripWhenRecurring : tripWhen)(b.startAt, b.endAt)}
                            </div>
                            {isSeries && (
                              // Every date, not just a count: "6 days" does not
                              // tell the approver whether one of them is a
                              // public holiday or the week they are away.
                              <div className="text-xs tabular-nums text-muted-foreground">
                                {seriesDates(g.items, t)}
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="truncate">{b.requester.name ?? b.requester.email}</span>
                              {isSeries && (
                                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                                  {ta("seriesBadge", { count: g.items.length })}
                                </span>
                              )}
                              <JobTypeChip jobType={b.jobType} />
                              <InChulaChip travelWithinChula={b.travelWithinChula} />
                              {b.isEmergency && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                                  {urgentLabel}
                                </span>
                              )}
                            </div>
                          </div>
                          <TriageChips flags={triageByBooking.get(b.id) ?? []} waitedHours={waitingHours(b.createdAt, now)} t={t} />
                        </div>
                        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </div>
                    {/* Approve and Deny both live on the card now. Deny used to
                        be detail-page only, to keep one action per card — but a
                        request the fleet cannot serve has to be refusable where
                        it is read, and the inline deny collects its reason
                        (preset chips + free text) without leaving the queue.
                        The WAITLIST rows below carry the same actions —
                        denyByApproverAction takes both statuses. */}
                    {isAdmin &&
                      (isSeries ? (
                        <SeriesQueueActions
                          parentId={g.key}
                          count={g.items.length}
                          returnTrip={b.returnTrip}
                          defaultEndTime={format(b.endAt, "HH:mm")}
                        />
                      ) : (
                        <ApproverQueueActions
                          bookingId={b.id}
                          canDeny
                          // The server refuses on `dayFull && !needsOutsourcing`
                          // — a requester who accepted an outside rental is
                          // approved straight to ส่งรถนอก on a full day, so
                          // hiding the button for them would block an approval
                          // the server would have allowed. The chip still shows
                          // วันเต็ม, which is why they are going outside.
                          dayFull={
                            !b.needsOutsourcing &&
                            (triageByBooking.get(b.id) ?? []).some((f) => f.key === "dayFull")
                          }
                          // Full day but the requester accepted an outside
                          // rental: approve still works, and the card has to say
                          // why it works here and not on the card below it.
                          outsourcingOnFullDay={
                            b.needsOutsourcing &&
                            (triageByBooking.get(b.id) ?? []).some((f) => f.key === "dayFull")
                          }
                          returnTrip={b.returnTrip}
                          startAt={format(b.startAt, "yyyy-MM-dd'T'HH:mm")}
                          endAt={format(b.endAt, "yyyy-MM-dd'T'HH:mm")}
                        />
                      ))}
                  </div>
                </li>
                );
              })}
            </ul>
        )}
        {allPendingGroups.length > pendingLimit && (
          <div className="mt-3">
            <Link href={showMoreHref} scroll={false}
                className="text-sm text-primary underline-offset-2 hover:underline">
              {t("showMore")}
            </Link>
          </div>
        )}
        </QueueBulkProvider>
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
                <div className="rounded-xl border border-amber-200 bg-card p-4 dark:border-amber-900/40">
                  <Link
                    href={`/admin/${b.id}`}
                    className="group -m-1 flex items-start justify-between gap-4 rounded-lg p-1 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div className="min-w-0">
                      <div className="space-y-0.5">
                      <div className="truncate font-medium">{b.purpose}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {b.destination} · {tripWhen(b.startAt, b.endAt)}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{b.requester.name ?? b.requester.email}</span>
                        <JobTypeChip jobType={b.jobType} />
                        <InChulaChip travelWithinChula={b.travelWithinChula} />
                        {b.isEmergency && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                            {urgentLabel}
                          </span>
                        )}
                      </div>
                      </div>
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
                  {/* Same three moves as a pending card, and for the same
                      reason: a WAITLIST row is over the day's capacity, so a
                      lone อนุมัติ was an offer the capacity gate then refused.
                      Go rearrange that day's board, refuse it, or override with
                      a written reason — dayFull decides which set renders, and
                      it clears itself once the day has room. */}
                  {isAdmin && <ApproverQueueActions
                        bookingId={b.id}
                        canDeny
                        dayFull={
                          !b.needsOutsourcing &&
                          (triageByBooking.get(b.id) ?? []).some((f) => f.key === "dayFull")
                        }
                        outsourcingOnFullDay={
                          b.needsOutsourcing &&
                          (triageByBooking.get(b.id) ?? []).some((f) => f.key === "dayFull")
                        }
                        returnTrip={b.returnTrip}
                        startAt={format(b.startAt, "yyyy-MM-dd'T'HH:mm")}
                        endAt={format(b.endAt, "yyyy-MM-dd'T'HH:mm")}
                      />}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Between approval and a car: the official form is generated but the
          signed copy is not back. Only an ADMIN can clear this, and doing so is
          what runs จัด. */}
      {awaitingDoc.length > 0 && (
        <Section title={t("awaitingDocHeading")} icon={<FileClock className="h-4 w-4" />}>
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-cyan-300 bg-cyan-50 p-3 text-sm font-medium text-cyan-900 dark:border-cyan-900/40 dark:bg-cyan-950/40 dark:text-cyan-200">
            <FileClock className="h-4 w-4 shrink-0" aria-hidden />
            {t("awaitingDocBanner")}
          </div>
          <ul className="space-y-2">
            {docGroups.map((g) => {
              const b = g.items[0]!;
              const isSeries = g.items.length > 1;
              return (
              <li key={g.key}>
                <div className="rounded-xl border border-cyan-200 bg-card p-4 dark:border-cyan-900/40">
                  <Link
                    href={`/admin/${b.id}`}
                    className="group -m-1 flex items-start justify-between gap-4 rounded-lg p-1 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="truncate font-medium">{b.purpose}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {b.destination} · {(isSeries ? tripWhenRecurring : tripWhen)(b.startAt, b.endAt)}
                      </div>
                      {isSeries && (
                        <div className="text-xs tabular-nums text-muted-foreground">
                          {seriesDates(g.items, t)}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{b.requester.name ?? b.requester.email}</span>
                        {isSeries && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                            {ta("seriesBadge", { count: g.items.length })}
                          </span>
                        )}
                        <JobTypeChip jobType={b.jobType} />
                        <InChulaChip travelWithinChula={b.travelWithinChula} />
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  {/* Siblings of the Link, never inside it — an anchor nested in
                      an anchor swallows one of the two clicks. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/* Confirming the document is the action; downloading it is
                        the reference. Primary action reads first. */}
                    {isAdmin && (
                      <DocumentApproveButton
                        bookingId={b.id}
                        seriesParentId={isSeries ? g.key : undefined}
                        label={isSeries ? ta("approveSeries", { count: g.items.length }) : t("awaitingDocApprove")}
                        pendingLabel={t("awaitingDocApproving")}
                      />
                    )}
                    <BookingDocumentLink
                      bookingId={b.id}
                      label={t("downloadDocument")}
                      hasPdf={!!b.pdfUrl}
                    />
                  </div>
                </div>
              </li>
              );
            })}
          </ul>
          {allDocGroups.length > docLimit && (
            <div className="mt-3">
              <Link href={moreHref("docLimit", docLimit)} scroll={false}
                className="text-sm text-primary underline-offset-2 hover:underline">
                {t("showMore")}
              </Link>
            </div>
          )}
        </Section>
      )}

      {/* Approved onto an outside rental, no vendor booked yet.
          These used to appear on NO admin screen at all while still showing in
          the requester's list — so the requester believed a vehicle was coming
          and nobody in the office had been told to hire one. Each row links to
          its day's board, which is where an outside row is created and the trip
          attached to it. */}
      {outsourcedNoVendor.length > 0 && (
        <Section title={t("outsourcedPendingHeading")} icon={<Bus className="h-4 w-4" />}>
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-violet-300 bg-violet-50 p-3 text-sm font-medium text-violet-900 dark:border-violet-900/40 dark:bg-violet-950/40 dark:text-violet-200">
            <Bus className="h-4 w-4 shrink-0" aria-hidden />
            {t("outsourcedPendingBanner")}
          </div>
          <ul className="space-y-2">
            {outsourcedNoVendor.map((b) => (
              <li key={b.id}>
                <div className="rounded-xl border border-violet-200 bg-card p-4 dark:border-violet-900/40">
                  <Link
                    href={`/admin/${b.id}`}
                    className="group -m-1 flex items-start justify-between gap-4 rounded-lg p-1 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="truncate font-medium">{b.purpose}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {b.destination} · {tripWhen(b.startAt, b.endAt)}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{b.requester.name ?? b.requester.email}</span>
                        <JobTypeChip jobType={b.jobType} />
                        <InChulaChip travelWithinChula={b.travelWithinChula} />
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  {/* Sibling of the Link, never inside it — an anchor nested in an
                      anchor swallows one of the two clicks. */}
                  <div className="mt-3">
                    <Link
                      href={`/admin/schedule?date=${format(b.startAt, "yyyy-MM-dd")}`}
                      className={cn(buttonVariants({ size: "sm" }))}
                    >
                      <Bus className="h-4 w-4" aria-hidden />
                      {t("outsourcedPendingAction")}
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* The รอจัดรถ list is gone: จัด now runs the moment a booking is approved,
          so nothing should sit here. What cannot be placed shows on that day's
          board instead (components/admin/unassigned-bar.tsx) — per-day, next to
          the cars, which is where it gets resolved. This count is all that is
          left of the cross-day view: one number, and where to start. */}
      {approved.length > 0 && (
        <Link
          href={`/admin/schedule?date=${format(approved[0].startAt, "yyyy-MM-dd")}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
        >
          <span>{t("unassignedCount").replace("%n%", String(approved.length))}</span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      )}

      <Section title={t("upcomingTrips")} icon={<CalendarClock className="h-4 w-4" />}>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={t("upcomingEmptyTitle")}
            description={t("upcomingEmptyDescription")}
          />
        ) : (
          <ul className="space-y-2">
            {tripGroups.map((g) => {
              const b = g.items[0]!;
              const isSeries = g.items.length > 1;
              return (
              <li key={g.key} className="rounded-xl border bg-card">
                <Link
                  href={`/admin/${b.id}`}
                  className="group flex items-start justify-between gap-4 rounded-xl p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <div className="min-w-0">
                    {/* The job number means nothing to anyone reading the list —
                        it is on the detail page for when it is actually needed. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <BookingStatusBadge status={b.status} />
                      {b.isEmergency && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                          {urgentLabel}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{b.purpose}</span>
                      {isSeries && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                          {ta("seriesBadge", { count: g.items.length })}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {formatTh(b.startAt, "EEE d MMM HH:mm")} ·{" "}
                      {b.vehicle?.registrationNumber ?? "—"} ·{" "}
                      {b.primaryDriver?.user.name ?? b.primaryDriver?.user.email ?? "—"}
                    </div>
                    {isSeries && (
                      // The car and driver above belong to the FIRST occurrence;
                      // the others may be dispatched differently, so the dates
                      // are listed without repeating an assignment that may not
                      // hold for them.
                      <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                        {seriesDates(g.items, t)}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
                {/* Outside the Link — the border moved to the <li> so the card
                    still reads as one block with the action below it. */}
                {b.pdfUrl && (
                  <div className="px-4 pb-3">
                    <BookingDocumentLink bookingId={b.id} label={t("downloadDocument")} />
                  </div>
                )}
              </li>
              );
            })}
          </ul>
        )}
        {allTripGroups.length > tripLimit && (
          <div className="mt-3">
            <Link href={moreHref("tripLimit", tripLimit)} scroll={false}
                className="text-sm text-primary underline-offset-2 hover:underline">
              {t("showMore")}
            </Link>
          </div>
        )}
      </Section>
    </div>
  );
}

type AdminT = Awaited<ReturnType<typeof getTranslations<"admin">>>;

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

// Occurrence dates for a series card.
//
// Printed in full, a 24-week booking laid 24 dates across the widest line on the
// card and wrapped to three rows of 11 px text — the noisiest thing on a screen
// whose job is triage. The first dates are what an approver checks; the rest is
// a count. Capped to whole dates, never mid-string, so nothing ends in an
// ellipsis that hides which day it was.
const SERIES_DATES_SHOWN = 8;

function seriesDates(items: { startAt: Date }[], t: AdminT): string {
  const all = items.map((o) => formatTh(o.startAt, "d MMM"));
  if (all.length <= SERIES_DATES_SHOWN + 1) return all.join(" · ");
  const shown = all.slice(0, SERIES_DATES_SHOWN).join(" · ");
  return `${shown} · ${t("seriesMoreDates", { count: all.length - SERIES_DATES_SHOWN })}`;
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
            ? t("triageDayFull")
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
