"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, GitPullRequestArrow, X } from "lucide-react";
import { applyDraftAction, dismissDraftAction } from "@/lib/booking/draft-actions";

export type DraftMove = {
  bookingId: string;
  jobNumber: string;
  purpose: string;
  startLabel: string;
  from: string;
  to: string;
};

// P'Top's review banner for a submitted driver trade draft. Apply commits every
// proposed move to the real schedule; Dismiss drops the draft untouched. Only
// rendered when there's a submitted draft.
export function DraftReviewPanel({
  moves,
  labels,
}: {
  moves: DraftMove[];
  labels: {
    title: string;
    summary: string;
    apply: string;
    dismiss: string;
    skipped: string;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function apply() {
    setNotice(null);
    startTransition(async () => {
      const res = await applyDraftAction();
      // Some moves can't commit (car already booked at that time, or unpaired car);
      // their drafts stay pending so they remain visible here to re-decide.
      if (res.skipped && res.skipped > 0) setNotice(labels.skipped.replace("{count}", String(res.skipped)));
      router.refresh();
    });
  }
  function dismiss() {
    setNotice(null);
    startTransition(async () => {
      await dismissDraftAction();
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitPullRequestArrow className="h-5 w-5 text-amber-700 dark:text-amber-400" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">{labels.title}</h2>
            <p className="text-xs text-amber-800/80 dark:text-amber-300/80">{labels.summary}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={dismiss}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber-300 bg-background px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-amber-900/50"
          >
            <X className="h-4 w-4" aria-hidden /> {labels.dismiss}
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-sm font-medium text-white hover:bg-amber-600/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Check className="h-4 w-4" aria-hidden /> {labels.apply}
          </button>
        </div>
      </div>

      {notice && (
        <p className="mt-3 flex items-center gap-1.5 rounded-md border border-amber-400/50 bg-amber-100/60 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {notice}
        </p>
      )}

      <ul className="mt-3 space-y-1.5">
        {moves.map((m) => (
          <li
            key={m.bookingId}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-background/60 px-3 py-1.5 text-xs dark:bg-background/30"
          >
            <span className="font-mono text-[10px] text-muted-foreground">{m.jobNumber}</span>
            <span className="font-medium">{m.startLabel}</span>
            <span className="truncate text-muted-foreground">{m.purpose}</span>
            <span className="ml-auto flex items-center gap-1.5 font-medium">
              <span className="text-muted-foreground line-through">{m.from}</span>
              <ArrowRight className="h-3 w-3" aria-hidden />
              <span className="text-amber-900 dark:text-amber-200">{m.to}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
