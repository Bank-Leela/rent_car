import Link from "next/link";
import { Car, CornerDownRight } from "lucide-react";
import type { DriverRoundsRow } from "@/lib/booking/driver-rounds";
import { RoundReassign, type ReassignTarget } from "@/components/admin/round-reassign";

// Whiteboard-style board: one row per driver, their day's rounds flowing
// left→right as chips (depart–return · place) that wrap as more are added.
// The kiosk renders it read-only; the admin additionally gets a per-round move
// control (`reassignTargets`) so a single trip can be re-homed without re-running
// the batch. Bulk assignment still lives on /admin/batch.
export function DriverRoundsBoard({
  rows,
  href,
  reassignTargets,
  labels,
}: {
  rows: DriverRoundsRow[];
  /** Per-round link target; omit for a non-clickable (kiosk) board. */
  href?: (bookingId: string) => string;
  /** Admin only: the cars a round can be moved to. Omit for the read-only kiosk. */
  reassignTargets?: ReassignTarget[];
  labels: {
    duty: string;
    free: string;
    coDriver: string;
    empty: string;
    noCar: string;
  };
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">{labels.empty}</div>
    );
  }

  // Job-type tint, matching the timeline board's palette so the colour language
  // carries over (TJW blue, OT amber, WERN emerald, NORMAL slate).
  const tint: Record<string, string> = {
    TJW: "border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40",
    OT: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
    WERN: "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40",
    NORMAL: "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60",
    SMUS: "border-violet-300 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40",
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.driverId} className="flex flex-col gap-2 p-3 sm:flex-row sm:gap-4">
            {/* Driver identity — fixed-width column, like the whiteboard's name column. */}
            <div className="flex shrink-0 items-center gap-2 sm:w-56">
              <span className="truncate text-sm font-semibold">{r.driverName ?? "—"}</span>
              {r.isDuty && (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
                  {labels.duty}
                </span>
              )}
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground sm:ml-0">
                {r.registrationNumber ?? labels.noCar}
              </span>
            </div>

            {/* Rounds — flow and wrap as the admin assigns more. */}
            {r.rounds.length === 0 ? (
              <p className="self-center text-sm text-muted-foreground">— {labels.free} —</p>
            ) : (
              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                {r.rounds.map((round) => {
                  const chip = (
                    <span
                      className={`block rounded-lg border px-2.5 py-1.5 ${tint[round.jobType] ?? tint.NORMAL} ${
                        round.state === "done" ? "opacity-60" : ""
                      } ${round.state === "inProgress" ? "ring-2 ring-primary/50" : ""}`}
                    >
                      <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                        {round.continuesBefore && <CornerDownRight className="h-3 w-3" aria-hidden />}
                        {round.startLabel}–{round.endLabel}
                        {round.continuesAfter && <span aria-hidden>↩</span>}
                      </span>
                      <span className="mt-0.5 flex max-w-52 items-center gap-1 truncate text-xs text-muted-foreground">
                        {round.isCoDriver && <Car className="h-3 w-3 shrink-0" aria-label={labels.coDriver} />}
                        {round.place}
                      </span>
                    </span>
                  );
                  const key = `${round.bookingId}-${round.isCoDriver ? "co" : "p"}`;
                  const body = href ? (
                    <Link
                      href={href(round.bookingId)}
                      className="rounded-lg transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {chip}
                    </Link>
                  ) : (
                    chip
                  );
                  // The move control targets the PRIMARY assignment; a co-driver
                  // ghost is moved by moving its own (primary) trip.
                  return reassignTargets && !round.isCoDriver ? (
                    <span key={key} className="group relative inline-flex items-start gap-0.5">
                      {body}
                      <RoundReassign
                        bookingId={round.bookingId}
                        targets={reassignTargets.filter((tg) => tg.driverId !== r.driverId)}
                      />
                    </span>
                  ) : (
                    <span key={key}>{body}</span>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
