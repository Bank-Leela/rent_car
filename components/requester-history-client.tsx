"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import type { BookingStatus } from "@prisma/client";
import { ListSearch } from "@/components/list-search";
import { EmptyState } from "@/components/empty-state";
import {
  RequesterBookingList,
  HISTORY_BOOKING_STATUSES,
  type RequesterBookingCard,
} from "@/components/requester-booking-list";

// How a request ENDED — the only question this log answers. The live statuses
// belong to the ที่จะมาถึง board, the trip-type chips asked something the
// requester never sorts by, and the date range is what the search box and the
// reverse-chronological order already cover.
const FILTERABLE_STATUSES: BookingStatus[] = [...HISTORY_BOOKING_STATUSES];

export function filterHistory(
  rows: RequesterBookingCard[],
  opts: { statuses?: BookingStatus[] },
): RequesterBookingCard[] {
  const statuses = opts.statuses?.length ? new Set(opts.statuses) : null;
  if (!statuses) return rows;
  return rows.filter((b) => statuses.has(b.status));
}

export function RequesterHistoryClient({
  bookings,
}: {
  bookings: RequesterBookingCard[];
}) {
  const t = useTranslations("listSearch");
  const th = useTranslations("historyFilters");
  const tdoc = useTranslations("requesterUpcoming");
  const params = useSearchParams();
  const [statuses, setStatuses] = useState<BookingStatus[]>(() => {
    const raw = params.get("status");
    if (!raw) return [];
    const wanted = raw.split(",");
    return FILTERABLE_STATUSES.filter((s) => wanted.includes(s));
  });

  // Persist the filter in the URL (shareable/bookmarkable) without an RSC
  // round-trip — filtering happens client-side on the already-loaded rows.
  // fromDate/toDate/jobType are cleared too, so a link bookmarked before those
  // filters were dropped doesn't leave dead params in the address bar.
  const syncUrl = (next: BookingStatus[]) => {
    const sp = new URLSearchParams(window.location.search);
    for (const stale of ["fromDate", "toDate", "jobType"]) sp.delete(stale);
    if (next.length) sp.set("status", next.join(","));
    else sp.delete("status");
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  };

  const toggleStatus = (s: BookingStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setStatuses(next);
    syncUrl(next);
  };
  const clear = () => {
    setStatuses([]);
    syncUrl([]);
  };

  const filtered = useMemo(() => filterHistory(bookings, { statuses }), [bookings, statuses]);
  const hasFilter = statuses.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
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
  );
}
