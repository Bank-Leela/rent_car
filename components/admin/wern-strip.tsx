import { BookingTimeEditor } from "@/components/admin/booking-time-editor";

export type WernJob = {
  id: string;
  destination: string;
  driverName: string | null;
  startHHmm: string;
  endHHmm: string;
  /** The trip's day, for the editor's "date does not move" line. */
  dateLabel: string;
};

// เวร jobs, with their hours editable in place.
//
// These are campus errands the duty driver runs, and their hour is the one
// P'Top slides most often, so they keep a strip of their own above the board —
// a control you have to hover a ~40px block to discover is a control nobody
// finds. Every other job type is now re-timeable too, from the clock on its own
// block; this strip is the shortcut for the common case, not the only door.
export function WernStrip({
  jobs,
  labels,
}: {
  jobs: WernJob[];
  labels: { title: string; empty: string };
}) {
  if (jobs.length === 0) return null;

  return (
    <section className="rounded-xl border border-emerald-300 bg-emerald-50/50 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
      <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
        {labels.title} · {jobs.length}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {jobs.map((j) => (
          <li
            key={j.id}
            className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs"
          >
            <span className="font-medium">{j.destination}</span>
            {j.driverName && <span className="text-muted-foreground">· {j.driverName}</span>}
            <span className="tabular-nums text-muted-foreground">
              {j.startHHmm}–{j.endHHmm}
            </span>
            <BookingTimeEditor
              bookingId={j.id}
              dateLabel={j.dateLabel}
              startHHmm={j.startHHmm}
              endHHmm={j.endHHmm}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
