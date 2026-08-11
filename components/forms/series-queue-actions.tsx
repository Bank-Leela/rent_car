"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DenyPresetChips } from "@/components/forms/deny-preset-chips";
import { FormError } from "@/components/forms/form-error";
import { approveSeriesAction, denySeriesAction, type SeriesBlock } from "@/lib/booking/approval-actions";

/**
 * One approve, one deny, for a whole recurring series.
 *
 * The occurrences do NOT share a fate — the fleet can be free on the 23rd and
 * full on the 30th — so this reports back per day rather than claiming a flat
 * success. Days that could not go through stay PENDING_APPROVAL and are listed,
 * because the approver still has to deal with them.
 */
export function SeriesQueueActions({
  parentId,
  count,
  returnTrip,
  defaultEndTime,
}: {
  parentId: string;
  count: number;
  /** One-way series need an arrival time; it applies to every occurrence's own date. */
  returnTrip: boolean;
  defaultEndTime: string;
}) {
  const t = useTranslations("approverActions");
  const router = useRouter();
  const [denyOpen, setDenyOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<SeriesBlock[] | null>(null);

  const run = async (fn: () => Promise<Awaited<ReturnType<typeof approveSeriesAction>>>) => {
    setPending(true);
    setError(null);
    setBlocked(null);
    const res = await fn();
    setPending(false);
    if (!res.ok && !(res.blocked?.length)) {
      setError(res.error ?? t("seriesNothingDone"));
      return;
    }

    const stuck = res.blocked ?? [];
    if (stuck.length > 0) {
      // A partial result has to survive the refresh, and an inline panel cannot:
      // once the successful occurrences leave the queue the card is no longer a
      // series, THIS component unmounts, and the message goes with it. A toast
      // outlives the re-render, which is the whole reason to use one here.
      toast.warning(t("seriesBlockedTitle", { count: stuck.length }), {
        description: stuck.map((x) => `${x.date} — ${x.reason}`).join("\n"),
        duration: 12000,
      });
    }
    if (res.ok) {
      // Only the days that went through leave the queue; the rest stay put and
      // are still on screen to be dealt with one at a time.
      setBlocked(null);
      router.refresh();
    } else {
      setBlocked(stuck);
    }
  };

  if (denyOpen) {
    return (
      <div className="mt-3 space-y-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">{t("seriesDenyHint", { count })}</p>
        <DenyPresetChips onPick={setReason} />
        <Textarea
          aria-label={t("reason")}
          placeholder={t("reason")}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <FormError message={error} />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={pending || reason.trim().length < 3}
            onClick={() =>
              run(() => {
                const fd = new FormData();
                fd.set("parentId", parentId);
                fd.set("comment", reason);
                return denySeriesAction(fd);
              })
            }
          >
            {pending ? t("denying") : t("deny")}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => { setDenyOpen(false); setReason(""); }}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      {!returnTrip && (
        <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {t("seriesEndTimeLabel")}
          <input
            type="time"
            step={900}
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={pending || (!returnTrip && !endTime)}
          onClick={() =>
            run(() => {
              const fd = new FormData();
              fd.set("parentId", parentId);
              if (!returnTrip) fd.set("endTime", endTime);
              return approveSeriesAction(fd);
            })
          }
        >
          <Check className="h-4 w-4" />
          {pending ? t("approving") : t("approveSeries", { count })}
        </Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={() => setDenyOpen(true)}>
          <X className="h-4 w-4" />
          {t("deny")}
        </Button>
      </div>

      {blocked && blocked.length > 0 && (
        // Named, not counted: the approver has to go and deal with these exact
        // days, and "3 failed" does not tell them which.
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-medium">{t("seriesBlockedTitle", { count: blocked.length })}</p>
          <ul className="mt-1 space-y-0.5">
            {blocked.map((b) => (
              <li key={b.id} className="tabular-nums">
                {b.date} — {b.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
