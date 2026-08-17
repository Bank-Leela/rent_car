import Link from "next/link";
import { Clock, FileDown } from "lucide-react";

export type TodayTripRow = {
  id: string;
  startLabel: string;
  destination: string;
  driverName: string | null;
  /** Translated car type (เก๋ง / กระบะ / ตู้ / รถ 6 ล้อ) — the plate was here
   *  before, and it told a driver nothing they could act on. */
  vehicleTypeLabel: string | null;
  state: "upcoming" | "inProgress" | "done";
  // The next trip departing within the coming hour — highlighted so a driver
  // glancing at the kiosk sees what's about to leave.
  isNext: boolean;
  /** The official form exists (set at approval) — offer it straight off the card. */
  hasPdf: boolean;
};

// Kiosk "today at a glance": the day's dispatched trips in leave order, above
// the timeline board. Server-rendered from the same day query as the board.
export function TodayTripsPanel({
  rows,
  labels,
}: {
  rows: TodayTripRow[];
  labels: {
    title: string;
    empty: string;
    upcoming: string;
    inProgress: string;
    done: string;
    next: string;
    document: string;
  };
}) {
  const stateChip: Record<TodayTripRow["state"], string> = {
    upcoming: "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
    inProgress: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    done: "bg-muted text-muted-foreground",
  };
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
        {labels.title}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li key={r.id} className="relative">
              {/* Sibling of the card link, not a child: an <a> inside an <a> is
                  invalid, and the whole card is one big link to the trip. */}
              {r.hasPdf && (
                <a
                  href={`/api/files/booking-pdf/${r.id}`}
                  aria-label={labels.document}
                  title={labels.document}
                  className="absolute bottom-2 right-2 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FileDown className="h-4 w-4" aria-hidden />
                </a>
              )}
              <Link
                href={`/driver/${r.id}`}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  r.isNext ? "border-primary ring-2 ring-primary/40" : ""
                } ${r.state === "done" ? "opacity-60" : ""} ${r.hasPdf ? "pr-12" : ""}`}
              >
                <span className="text-xl font-bold tabular-nums">{r.startLabel}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.destination}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.vehicleTypeLabel ?? "—"}
                    {r.driverName ? ` · ${r.driverName}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {r.isNext && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      {labels.next}
                    </span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stateChip[r.state]}`}>
                    {labels[r.state]}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
