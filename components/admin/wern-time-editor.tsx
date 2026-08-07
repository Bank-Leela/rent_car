"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { setWernTimeAction } from "@/lib/booking/schedule-actions";

// เวร work is campus errands the duty driver runs — the hour is negotiable in a
// way a meeting pickup is not, so P'Top routinely slides one to make room. Every
// other trip's time is the requester's booking and is not the dispatcher's to
// change, which is why this control only appears on เวร blocks and the action
// refuses anything else.
//
// Times only, not dates: a เวร is a same-day campus round, and letting it move
// across days from a one-day board would be a way to lose it.
export function WernTimeEditor({
  bookingId,
  date,
  startHHmm,
  endHHmm,
}: {
  bookingId: string;
  /** yyyy-MM-dd of the viewed day. */
  date: string;
  startHHmm: string;
  endHHmm: string;
}) {
  const t = useTranslations("scheduler");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(startHHmm);
  const [to, setTo] = useState(endHHmm);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("bookingId", bookingId);
      fd.set("startAt", `${date}T${from}`);
      fd.set("endAt", `${date}T${to}`);
      const res = (await setWernTimeAction(fd)) as { ok: boolean; error?: string };
      if (!res.ok) {
        setError(res.error ?? null);
        return;
      }
      setOpen(false);
      router.refresh();
    });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("wernEditTime")}
        aria-label={t("wernEditTime")}
        className="rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Clock className="h-3 w-3" aria-hidden />
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1 rounded-md border bg-background p-1 text-[11px] shadow-sm">
      <input
        type="time"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        aria-label={t("wernFrom")}
        className="h-6 w-[4.5rem] rounded border border-input bg-background px-1"
      />
      <span aria-hidden>–</span>
      <input
        type="time"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        aria-label={t("wernTo")}
        className="h-6 w-[4.5rem] rounded border border-input bg-background px-1"
      />
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="rounded bg-primary px-1.5 py-0.5 font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? "…" : t("wernSave")}
      </button>
      <button type="button" disabled={pending} onClick={() => setOpen(false)} className="px-1 text-muted-foreground">
        ✕
      </button>
      {error && <span className="w-full text-destructive">{t(`dropError_${error}`) || error}</span>}
    </span>
  );
}
