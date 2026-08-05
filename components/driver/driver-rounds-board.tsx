import Link from "next/link";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import { Car, CornerDownRight, Moon } from "lucide-react";
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
    overnight: string;
    nightOf: string;
    backOn: string;
    leftOn: string;
    returnAt: string;
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
    <div className="overflow-hidden rounded-xl border bg-card">
      <ul className="divide-y">
        {rows.map((r) => (
          // The เวร (duty) driver is reserved all day — they run campus rounds and
          // are excluded from every other auto-assignment. A small badge was easy
          // to miss when scanning; the whole row is tinted with an edge stripe so
          // "who is on duty today" is answered at a glance.
          <li
            key={r.driverId}
            className={`flex flex-col gap-2 p-3 sm:flex-row sm:gap-4 ${
              r.isDuty
                ? "border-l-4 border-l-emerald-500 bg-emerald-50/60 pl-2 dark:bg-emerald-950/25"
                : ""
            }`}
          >
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
                  // An overnight trip says what is true on THIS day: it leaves,
                  // it's away, or it comes back. A start–end time only makes
                  // sense on a same-day round.
                  const d = (x: Date) => format(x, "d MMM", { locale: th });
                  const headline =
                    round.phase === "depart" ? (
                      <>
                        {round.startLabel} <span className="font-normal">→ {labels.overnight}</span>
                      </>
                    ) : round.phase === "away" ? (
                      <>
                        {labels.overnight}
                        {round.nightIndex && round.nightTotal ? (
                          <span className="font-normal">
                            {" · "}
                            {labels.nightOf.replace("%n%", String(round.nightIndex)).replace("%total%", String(round.nightTotal))}
                          </span>
                        ) : null}
                      </>
                    ) : round.phase === "return" ? (
                      <>{labels.returnAt.replace("%time%", round.endLabel)}</>
                    ) : (
                      <>
                        {round.startLabel}–{round.endLabel}
                      </>
                    );
                  // Second line pins the other end of the trip, so a driver reading
                  // a middle day still knows when they get back.
                  const subline =
                    round.phase === "depart" || round.phase === "away"
                      ? labels.backOn.replace("%date%", d(round.returnAt))
                      : round.phase === "return"
                        ? labels.leftOn.replace("%date%", d(round.departAt))
                        : null;
                  const chip = (
                    <span
                      className={`block rounded-lg border px-2.5 py-1.5 ${tint[round.jobType] ?? tint.NORMAL} ${
                        round.state === "done" ? "opacity-60" : ""
                      } ${round.state === "inProgress" ? "ring-2 ring-primary/50" : ""} ${
                        round.phase === "away" ? "border-dashed" : ""
                      }`}
                    >
                      <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                        {round.phase === "return" && <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden />}
                        {round.phase === "away" && <Moon className="h-3 w-3 shrink-0" aria-hidden />}
                        {headline}
                      </span>
                      <span className="mt-0.5 flex max-w-52 items-center gap-1 truncate text-xs text-muted-foreground">
                        {round.isCoDriver && <Car className="h-3 w-3 shrink-0" aria-label={labels.coDriver} />}
                        {round.place}
                        {subline ? ` · ${subline}` : ""}
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
