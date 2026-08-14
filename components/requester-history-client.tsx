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
  HISTORY_BOOKING_STATUSES,
  type RequesterBookingCard,
} from "@/components/requester-booking-list";

// How a request ENDED — the only question this log answers. The live statuses
// belong to the ที่จะมาถึง board.
const FILTERABLE_STATUSES: BookingStatus[] = [...HISTORY_BOOKING_STATUSES];
// Job type comes back as a facet, but as a SIDEBAR one rather than the chip row
// it used to be. Every row already carries `jobType` and nothing rendered it, so
// this costs no query and no new copy — jobType.* is enum-pinned.
const FILTERABLE_JOB_TYPES: JobType[] = ["NORMAL", "OT", "TJW", "WERN", "SMUS"];

export function filterHistory(
  rows: RequesterBookingCard[],
  opts: { statuses?: BookingStatus[]; jobTypes?: JobType[] },
): RequesterBookingCard[] {
  const statuses = opts.statuses?.length ? new Set<string>(opts.statuses) : null;
  const jobTypes = opts.jobTypes?.length ? new Set<string>(opts.jobTypes) : null;
  return rows.filter(
    (b) => (!statuses || statuses.has(b.status)) && (!jobTypes || jobTypes.has(b.jobType)),
  );
}

/**
 * One row of the filter rail: a real checkbox, its label, and how many rows it
 * would leave.
 *
 * min-h-11 because the old chips were h-9 (36 px) — under the 44 px touch
 * minimum, on a list people filter from a phone. The whole row is the label, so
 * the tap target is the full width rather than the 16 px box.
 */
function FacetRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm transition-colors hover:bg-muted/60 ${
        count === 0 && !checked ? "opacity-50" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {/* The count is the point of the pattern: it says what a filter will do
          before you spend a click on it. Tabular so the column of numbers on the
          right stays straight. */}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">({count})</span>
    </label>
  );
}

export function RequesterHistoryClient({
  bookings,
}: {
  bookings: RequesterBookingCard[];
}) {
  const t = useTranslations("listSearch");
  const th = useTranslations("historyFilters");
  const tj = useTranslations("jobType");
  const tdoc = useTranslations("requesterUpcoming");
  const params = useSearchParams();

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
    return FILTERABLE_JOB_TYPES.filter((j) => wanted.includes(j));
  });

  // Persist both facets in the URL (shareable/bookmarkable) without an RSC
  // round-trip — filtering happens client-side on the already-loaded rows.
  const syncUrl = (nextStatuses: BookingStatus[], nextJobTypes: JobType[]) => {
    const sp = new URLSearchParams(window.location.search);
    for (const stale of ["fromDate", "toDate"]) sp.delete(stale);
    if (nextStatuses.length) sp.set("status", nextStatuses.join(","));
    else sp.delete("status");
    if (nextJobTypes.length) sp.set("jobType", nextJobTypes.join(","));
    else sp.delete("jobType");
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };

  const toggleStatus = (s: BookingStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setStatuses(next);
    syncUrl(next, jobTypes);
  };
  const toggleJobType = (j: JobType) => {
    const next = jobTypes.includes(j) ? jobTypes.filter((x) => x !== j) : [...jobTypes, j];
    setJobTypes(next);
    syncUrl(statuses, next);
  };
  const clear = () => {
    setStatuses([]);
    setJobTypes([]);
    syncUrl([], []);
  };

  const filtered = useMemo(
    () => filterHistory(bookings, { statuses, jobTypes }),
    [bookings, statuses, jobTypes],
  );

  // Faceted counts: each option is counted against the OTHER facet's selection,
  // never against its own. Counting against everything would freeze the numbers;
  // counting against the fully-filtered set would show (0) beside the very box
  // you just ticked.
  const statusCounts = useMemo(() => {
    const base = filterHistory(bookings, { jobTypes });
    const m = new Map<string, number>();
    for (const b of base) m.set(b.status, (m.get(b.status) ?? 0) + 1);
    return m;
  }, [bookings, jobTypes]);
  const jobTypeCounts = useMemo(() => {
    const base = filterHistory(bookings, { statuses });
    const m = new Map<string, number>();
    for (const b of base) m.set(b.jobType, (m.get(b.jobType) ?? 0) + 1);
    return m;
  }, [bookings, statuses]);

  const hasFilter = statuses.length > 0 || jobTypes.length > 0;

  return (
    // Sidebar rail on the left, results on the right — the reference's shape.
    // It stacks above the list below `lg`, where a 224 px column would leave the
    // rows too narrow to read.
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <aside className="shrink-0 lg:w-56">
        {/* sticky so the facets stay reachable while scrolling forty rows; top-20
            clears the 56 px app bar plus a little air. */}
        <div className="space-y-5 lg:sticky lg:top-20">
          <section className="space-y-1">
            <h3 className="px-2 text-sm font-semibold">{th("groupStatus")}</h3>
            {FILTERABLE_STATUSES.map((s) => (
              <FacetRow
                key={s}
                label={th(`status_${s}`)}
                count={statusCounts.get(s) ?? 0}
                checked={statuses.includes(s)}
                onChange={() => toggleStatus(s)}
              />
            ))}
          </section>

          <section className="space-y-1">
            <h3 className="px-2 text-sm font-semibold">{th("groupJobType")}</h3>
            {FILTERABLE_JOB_TYPES.map((j) => (
              <FacetRow
                key={j}
                label={tj(j)}
                count={jobTypeCounts.get(j) ?? 0}
                checked={jobTypes.includes(j)}
                onChange={() => toggleJobType(j)}
              />
            ))}
          </section>

          {hasFilter && (
            <button
              type="button"
              onClick={clear}
              className="inline-flex min-h-11 items-center px-2 text-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {th("clear")}
            </button>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <ListSearch
          items={filtered}
          keys={["destination", "purpose"]}
          render={(rows) =>
            rows.length === 0 ? (
              <EmptyState icon={FileText} title={t("noMatches")} />
            ) : (
              <RequesterBookingList bookings={rows} documentLabel={tdoc("downloadDocument")} />
            )
          }
        />
      </div>
    </div>
  );
}
