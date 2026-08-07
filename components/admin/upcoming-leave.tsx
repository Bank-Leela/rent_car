"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { setDriverLeaveRangeAction } from "@/lib/booking/availability-actions";

export type LeaveBlock = {
  driverId: string;
  name: string;
  /** "yyyy-MM-dd" — inclusive. A single day has from === to. */
  from: string;
  to: string;
  label: string;
};

// Nothing anywhere showed leave beyond the day you were looking at, so an
// absence next week was invisible until you happened to open that day and found
// an empty row. Consecutive days are collapsed into one block on the server, so
// a week off reads as one entry rather than seven.
export function UpcomingLeave({ blocks }: { blocks: LeaveBlock[] }) {
  const t = useTranslations("roster");
  const router = useRouter();
  const [pending, start] = useTransition();

  const clear = (b: LeaveBlock) =>
    start(async () => {
      const fd = new FormData();
      fd.set("driverId", b.driverId);
      fd.set("from", b.from);
      fd.set("to", b.to);
      fd.set("off", "false");
      await setDriverLeaveRangeAction(fd);
      router.refresh();
    });

  return (
    <div className="mt-3">
      <h3 className="text-xs font-medium text-muted-foreground">{t("upcomingTitle")}</h3>
      {blocks.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{t("upcomingEmpty")}</p>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-2">
          {blocks.map((b) => (
            <li
              key={`${b.driverId}-${b.from}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <span className="font-medium">{b.name}</span>
              <span className="tabular-nums">{b.label}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => clear(b)}
                aria-label={t("upcomingClear")}
                title={t("upcomingClear")}
                className="rounded p-0.5 hover:bg-amber-200/60 disabled:opacity-50 dark:hover:bg-amber-900/40"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
