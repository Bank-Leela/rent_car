import Link from "next/link";
import { AssignRecoButton } from "@/components/forms/assign-reco-button";

export type UnassignedRow = {
  id: string;
  destination: string;
  timeLabel: string;
  /** Why the solver could not place it, or the kind that never auto-assigns. */
  reasonLabel: string;
  /** Present only when a legal car was found — one click assigns it. */
  reco: { vehicleId: string; secondaryDriverId: string | null; label: string } | null;
};

// Everything on the viewed day that still needs a car.
//
// จัด runs on approval now, so this bar is the exception list rather than a
// queue: what is left is either genuine overflow (no legal car+driver — the
// "13th case") or one of the kinds that deliberately never auto-assign
// (ตจว–ค้างคืน, จองเร่งด่วน, รถบัสเช่า).
//
// It is keyed on "APPROVED with no driver", NOT on overflowReason: the solver
// never even looks at the deliberately-manual kinds, so they never get that
// column set, and filtering on it would hide exactly the bookings that most need
// P'Top's attention.
export function UnassignedBar({
  rows,
  labels,
}: {
  rows: UnassignedRow[];
  labels: { title: string; empty: string; open: string };
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        {labels.empty}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-amber-300 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
      <h2 className="border-b border-amber-300/60 px-4 py-2 text-sm font-semibold text-amber-900 dark:border-amber-900/40 dark:text-amber-200">
        {labels.title} · {rows.length}
      </h2>
      <ul className="divide-y divide-amber-300/40 dark:divide-amber-900/30">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <Link href={`/admin/${r.id}`} className="font-medium hover:underline">
                {r.destination}
              </Link>
              <span className="ml-2 text-muted-foreground tabular-nums">{r.timeLabel}</span>
            </span>
            <span className="shrink-0 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
              {r.reasonLabel}
            </span>
            {r.reco ? (
              <AssignRecoButton
                bookingId={r.id}
                vehicleId={r.reco.vehicleId}
                secondaryDriverId={r.reco.secondaryDriverId}
                label={r.reco.label}
              />
            ) : (
              <Link
                href={`/admin/${r.id}`}
                className="shrink-0 rounded-md border bg-background px-2.5 py-1 text-xs hover:bg-muted"
              >
                {labels.open}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
