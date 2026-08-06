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
  legend,
}: {
  rows: DriverRoundsRow[];
  /** Per-round link target; omit for a non-clickable (kiosk) board. */
  href?: (bookingId: string) => string;
  /** Admin only: the cars a round can be moved to. Omit for the read-only kiosk. */
  reassignTargets?: ReassignTarget[];
  labels: {
    duty: string;
    off: string;
    free: string;
    coDriver: string;
    empty: string;
    overnight: string;
    nightOf: string;
    backOn: string;
    leftOn: string;
    returnAt: string;
  };
  /** Thai job-type names for the colour key, plus what the tinted rows mean. */
  legend: { TJW: string; OT: string; WERN: string; NORMAL: string; dutyRow: string; offRow: string };
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">{labels.empty}</div>
    );
  }

  // Colour means "this trip is not ordinary". ทั่วไป is the common case and gets
  // no fill at all — an outlined chip — so it can never be mistaken for ตจว; a
  // slate wash and a dark-blue wash were nearly the same colour in dark theme.
  // The remaining types keep their established hues, at full strength in dark so
  // they read as blue/amber/green rather than as shades of near-black.
  const tint: Record<string, string> = {
    TJW: "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/50",
    OT: "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/50",
    WERN: "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/50",
    NORMAL: "border-border bg-transparent",
  };
  // ตจว / โอที / เวร / ทั่วไป — the four types an internal driver can be given.
  const legendTypes = ["TJW", "OT", "WERN", "NORMAL"] as const;
  const dutyRowStyle = "border-l-4 border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/25";
  // Off sick/on leave: struck out of the day rather than tinted like a job type —
  // this row is a person who is NOT available, the opposite of a เวร row.
  const offRowStyle = "border-l-4 border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20";

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* Colour key. The swatches are the chip and row styles themselves, so the
          key cannot drift from what the board actually paints. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {legendTypes.map((jt) => (
          <span key={jt} className="flex items-center gap-1.5">
            <span className={`h-3.5 w-3.5 shrink-0 rounded border ${tint[jt]}`} aria-hidden />
            {legend[jt]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          {/* Wider and square, so it reads as a slice of a row rather than a
              chip — and no outer border, or the edge stripe becomes a pill. */}
          <span className={`h-3.5 w-6 shrink-0 ${dutyRowStyle}`} aria-hidden />
          {legend.dutyRow}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-3.5 w-6 shrink-0 ${offRowStyle}`} aria-hidden />
          {legend.offRow}
        </span>
      </div>

      <ul className="divide-y">
        {rows.map((r) => (
          // The เวร (duty) driver is reserved all day — they run campus rounds and
          // are excluded from every other auto-assignment. A small badge was easy
          // to miss when scanning; the whole row is tinted with an edge stripe so
          // "who is on duty today" is answered at a glance.
          <li
            key={r.driverId}
            className={`flex flex-col gap-2 p-3 sm:flex-row sm:gap-4 ${
              r.isOff ? `${offRowStyle} pl-2` : r.isDuty ? `${dutyRowStyle} pl-2` : ""
            }`}
          >
            {/* Driver identity — fixed-width column, like the whiteboard's name column. */}
            <div className="flex shrink-0 items-center gap-2 sm:w-56">
              <span
                className={`truncate text-sm font-semibold ${r.isOff ? "text-muted-foreground line-through" : ""}`}
              >
                {r.driverName ?? "—"}
              </span>
              {r.isOff && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                  {labels.off}
                </span>
              )}
              {!r.isOff && r.isDuty && (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
                  {labels.duty}
                </span>
              )}
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
