"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import type { BookingStatus, JobType } from "@prisma/client";
import { ListSearch } from "@/components/list-search";
import { EmptyState } from "@/components/empty-state";
import {
  RequesterBookingList,
  ACTIVE_BOOKING_STATUSES,
  HISTORY_BOOKING_STATUSES,
  type RequesterBookingCard,
} from "@/components/requester-booking-list";

// The log lists every request, so the status filter has to offer the live
// statuses too — otherwise a requester can't narrow to the ones still waiting.
// DRAFT is omitted: a draft was never submitted, so it isn't a request yet.
const FILTERABLE_STATUSES = [
  ...ACTIVE_BOOKING_STATUSES.filter((s) => s !== "DRAFT"),
  ...HISTORY_BOOKING_STATUSES,
];

const FILTERABLE_JOB_TYPES: JobType[] = ["NORMAL", "OT", "TJW", "WERN", "SMUS"];

// Pure so it's unit-testable: date-range (on startAt, whole days) + status + type.
export function filterHistory(
  rows: RequesterBookingCard[],
  opts: { fromDate?: string; toDate?: string; statuses?: BookingStatus[]; jobTypes?: JobType[] },
): RequesterBookingCard[] {
  const from = opts.fromDate ? new Date(`${opts.fromDate}T00:00:00`) : null;
  const to = opts.toDate ? new Date(`${opts.toDate}T23:59:59.999`) : null;
  const statuses = opts.statuses?.length ? new Set(opts.statuses) : null;
  const jobTypes = opts.jobTypes?.length ? new Set(opts.jobTypes) : null;
  return rows.filter((b) => {
    if (from && b.startAt < from) return false;
    if (to && b.startAt > to) return false;
    if (statuses && !statuses.has(b.status)) return false;
    if (jobTypes && !jobTypes.has(b.jobType)) return false;
    return true;
  });
}

export function RequesterHistoryClient({
  bookings,
}: {
  bookings: RequesterBookingCard[];
}) {
  const t = useTranslations("listSearch");
  const th = useTranslations("historyFilters");
  const tjt = useTranslations("jobType");
  const params = useSearchParams();
  const [fromDate, setFromDate] = useState(params.get("fromDate") ?? "");
  const [toDate, setToDate] = useState(params.get("toDate") ?? "");
  const [statuses, setStatuses] = useState<BookingStatus[]>(() => {
    const raw = params.get("status");
    if (!raw) return [];
    const wanted = raw.split(",");
    return FILTERABLE_STATUSES.filter((s) => wanted.includes(s));
  });
  const [jobTypes, setJobTypes] = useState<JobType[]>(() => {
    const raw = params.get("jobType");
    if (!raw) return [];
    const wanted = raw.split(",");
    return FILTERABLE_JOB_TYPES.filter((s) => wanted.includes(s));
  });

  // Persist filters in the URL (shareable/bookmarkable) without an RSC
  // round-trip — filtering happens client-side on the already-loaded rows.
  const syncUrl = (next: { fromDate: string; toDate: string; statuses: BookingStatus[]; jobTypes: JobType[] }) => {
    const sp = new URLSearchParams(window.location.search);
    for (const [k, v] of [
      ["fromDate", next.fromDate],
      ["toDate", next.toDate],
      ["status", next.statuses.join(",")],
      ["jobType", next.jobTypes.join(",")],
    ] as const) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };

  const toggleStatus = (s: BookingStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setStatuses(next);
    syncUrl({ fromDate, toDate, statuses: next, jobTypes });
  };
  const toggleJobType = (j: JobType) => {
    const next = jobTypes.includes(j) ? jobTypes.filter((x) => x !== j) : [...jobTypes, j];
    setJobTypes(next);
    syncUrl({ fromDate, toDate, statuses, jobTypes: next });
  };
  const setDate = (which: "from" | "to", v: string) => {
    if (which === "from") setFromDate(v);
    else setToDate(v);
    syncUrl({ fromDate: which === "from" ? v : fromDate, toDate: which === "to" ? v : toDate, statuses, jobTypes });
  };
  const clear = () => {
    setFromDate("");
    setToDate("");
    setStatuses([]);
    setJobTypes([]);
    syncUrl({ fromDate: "", toDate: "", statuses: [], jobTypes: [] });
  };

  const filtered = useMemo(
    () => filterHistory(bookings, { fromDate, toDate, statuses, jobTypes }),
    [bookings, fromDate, toDate, statuses, jobTypes],
  );
  const hasFilter = !!(fromDate || toDate || statuses.length || jobTypes.length);

  const dateCls =
    "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {th("from")}
          <input type="date" value={fromDate} onChange={(e) => setDate("from", e.target.value)} className={dateCls} aria-label={th("from")} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {th("to")}
          <input type="date" value={toDate} onChange={(e) => setDate("to", e.target.value)} className={dateCls} aria-label={th("to")} />
        </label>
        {FILTERABLE_STATUSES.map((s) => {
          const active = statuses.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              aria-pressed={active}
              className={`inline-flex h-9 items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {th(`status_${s}`)}
            </button>
          );
        })}
      </div>

      {/* Job type on its own row: two independent questions ("how far along is
          it?" and "what kind of trip?") read as one long strip otherwise. */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERABLE_JOB_TYPES.map((j) => {
          const active = jobTypes.includes(j);
          return (
            <button
              key={j}
              type="button"
              onClick={() => toggleJobType(j)}
              aria-pressed={active}
              className={`inline-flex h-9 items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {tjt(j)}
            </button>
          );
        })}
        {hasFilter && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex h-9 items-center rounded-md px-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {th("clear")}
          </button>
        )}
      </div>

      <ListSearch
        items={filtered}
        keys={["destination", "purpose", "jobNumber"]}
        render={(rows) =>
          rows.length === 0 ? (
            <EmptyState icon={FileText} title={t("noMatches")} />
          ) : (
            <RequesterBookingList bookings={rows} />
          )
        }
      />
    </div>
  );
}
