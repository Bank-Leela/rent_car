import { WernTimeEditor } from "@/components/admin/wern-time-editor";

export type WernJob = {
  id: string;
  destination: string;
  driverName: string | null;
  startHHmm: string;
  endHHmm: string;
};

// เวร jobs, with their hours editable in place.
//
// These are campus errands the duty driver runs, and their hour is negotiable in
// a way a meeting pickup is not — P'Top routinely slides one to make room. Every
// other trip's time is the requester's booking and is not the dispatcher's to
// change, so only เวร appears here.
//
// It is a strip above the board rather than a control inside each timeline
// block: a block is ~40px wide at this zoom, which is no place for two time
// fields, and a control you have to hover a 40px target to discover is a
// control nobody finds.
export function WernStrip({
  jobs,
  date,
  labels,
}: {
  jobs: WernJob[];
  date: string;
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
            <WernTimeEditor
              bookingId={j.id}
              date={date}
              startHHmm={j.startHHmm}
              endHHmm={j.endHHmm}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
