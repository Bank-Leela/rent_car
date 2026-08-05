"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Car, CircleSlash, FlaskConical, UserRound, CalendarPlus } from "lucide-react";
import { SelectField } from "@/components/ui/select-field";
import { TimeField } from "@/components/ui/time-field";
import { simulatePlacementAction, bookSimulatedSlotAction, type SimResult } from "@/lib/booking/simulate-actions";

const JOB_TYPES = ["NORMAL", "OT", "TJW", "WERN", "SMUS"] as const;

export function SimulateForm({ today }: { today: string }) {
  const t = useTranslations("simulate");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SimResult | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // No-wait split: when off, the driver drops off then returns later, so the
  // sim feeds the two-leg booking to the leg-aware solver.
  const [wait, setWait] = useState(true);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBooked(null);
    setBookError(null);
    startTransition(async () => {
      setResult(await simulatePlacementAction(fd));
    });
  }

  // Commit the previewed slot: re-submit the same form to the persisting action.
  function book() {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    startTransition(async () => {
      const res = await bookSimulatedSlotAction(fd);
      if (res.ok) {
        setBooked(res.jobNumber);
        setBookError(null);
      } else {
        setBookError(res.error);
      }
    });
  }

  const field = "h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const label = "mb-1 block text-xs font-medium text-muted-foreground";

  return (
    <div className="space-y-5">
      <form ref={formRef} onSubmit={onSubmit} className="rounded-xl border p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="sim-date" className={label}>{t("date")}</label>
            <input id="sim-date" name="date" type="date" defaultValue={today} required className={field} />
          </div>
          <div>
            <label htmlFor="sim-jobType" className={label}>{t("jobType")}</label>
            <SelectField
              id="sim-jobType"
              name="jobType"
              defaultValue="NORMAL"
              className="h-10"
              options={JOB_TYPES.map((jt) => ({ value: jt, label: t(`jt_${jt}`) }))}
            />
          </div>
          <div>
            <label htmlFor="sim-km" className={label}>{t("km")}</label>
            <input id="sim-km" name="km" type="number" min={0} step={1} placeholder={t("kmPlaceholder")} className={field} />
          </div>
          <div>
            <label htmlFor="sim-start" className={label}>{t("start")}</label>
            <TimeField id="sim-start" name="start" defaultValue="09:00" required className="h-10" aria-label={t("start")} />
          </div>
          <div>
            <label htmlFor="sim-end" className={label}>{t("end")}</label>
            <TimeField id="sim-end" name="end" defaultValue="12:00" required className="h-10" aria-label={t("end")} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wait}
                onChange={(e) => setWait(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              {t("waitLabel")}
            </label>
          </div>
          <input type="hidden" name="wait" value={wait ? "true" : ""} />
          {!wait && (
            <>
              <div>
                <label htmlFor="sim-drop" className={label}>{t("dropOffLabel")}</label>
                <TimeField id="sim-drop" name="dropOff" defaultValue="11:00" className="h-10" aria-label={t("dropOffLabel")} />
              </div>
              <div>
                <label htmlFor="sim-return" className={label}>{t("returnLabel")}</label>
                <TimeField id="sim-return" name="pickupReturn" defaultValue="14:00" className="h-10" aria-label={t("returnLabel")} />
              </div>
            </>
          )}
          <div className="flex items-end">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <FlaskConical className="h-4 w-4" aria-hidden /> {pending ? t("running") : t("run")}
            </button>
          </div>
        </div>
      </form>

      <div aria-live="polite" role="status">
        {result && (
          <ResultCard
            result={result}
            t={t}
            onBook={book}
            booking={pending}
            booked={booked}
            bookError={bookError}
          />
        )}
      </div>
    </div>
  );
}

function ResultCard({
  result,
  t,
  onBook,
  booking,
  booked,
  bookError,
}: {
  result: SimResult;
  t: ReturnType<typeof useTranslations>;
  onBook: () => void;
  booking: boolean;
  booked: string | null;
  bookError: string | null;
}) {
  const tjt = useTranslations("jobType");
  if (!result.ok) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
        {t(`error_${result.error}`)}
      </div>
    );
  }

  const duty = result.dutyDriverName ? t("dutyContext", { name: result.dutyDriverName }) : t("dutyNone");

  if (result.kind === "none") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
        <div className="flex items-center gap-2 text-destructive">
          <CircleSlash className="h-5 w-5" aria-hidden />
          <h2 className="text-sm font-semibold">{t("noneTitle")}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t(`reason_${result.reason}`)}</p>
        <p className="mt-3 text-xs text-muted-foreground">{duty}</p>
      </div>
    );
  }

  const reclaim = result.kind === "reclaim";
  return (
    <div className={`rounded-xl border p-5 ${reclaim ? "border-amber-400/50 bg-amber-50 dark:bg-amber-950/20" : "border-emerald-400/50 bg-emerald-50 dark:bg-emerald-950/20"}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${reclaim ? "bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100" : "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"}`}>
          {reclaim ? t("kindReclaim") : t("kindFit")}
        </span>
        <span className="text-xs text-muted-foreground">{tjt(result.jobType)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="flex items-center gap-2 text-lg font-semibold">
          <Car className="h-5 w-5 text-muted-foreground" aria-hidden />
          {result.registrationNumber ?? "—"}
        </span>
        <span className="flex items-center gap-2 text-lg font-semibold">
          <UserRound className="h-5 w-5 text-muted-foreground" aria-hidden />
          {result.driverName ?? "—"}
        </span>
        {result.secondaryDriverName && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <UserRound className="h-4 w-4" aria-hidden /> + {result.secondaryDriverName} ({t("coDriver")})
          </span>
        )}
      </div>
      {reclaim && <p className="mt-2 text-xs text-amber-800 dark:text-amber-300/90">{t("reclaimDetail")}</p>}
      <p className="mt-3 text-xs text-muted-foreground">{duty}</p>
      <div className="mt-4 border-t pt-3">
        {booked ? (
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{t("bookedDone", { job: booked })}</p>
        ) : (
          <>
            <button
              type="button"
              onClick={onBook}
              disabled={booking}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <CalendarPlus className="h-4 w-4" aria-hidden /> {t("bookSlot")}
            </button>
            {bookError && <p className="mt-1.5 text-xs text-destructive">{t("bookFailed")}</p>}
          </>
        )}
      </div>
    </div>
  );
}
