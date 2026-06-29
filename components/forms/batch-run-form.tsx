"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { runBatchAction } from "@/lib/booking/batch-actions";
import {
  simulateAndRunBatchAction,
  clearBatchDemoAction,
} from "@/lib/booking/batch-demo-actions";
import { assignTjwByRequestOrder } from "@/lib/booking/tjw-request-actions";

type Stats = {
  pendingCount: number;
  matchedCount: number;
  overflowByReason: Record<string, number>;
};

export function BatchRunForm({ defaultDate }: { defaultDate: string }) {
  const t = useTranslations("adminBatch");
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);
  const [cleared, setCleared] = useState<number | null>(null);
  const [tjw, setTjw] = useState<{ assigned: number; overflows: { reason: string }[] } | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    router.replace(`/admin/batch?date=${date}`);
    router.refresh();
  }

  function reset() {
    setError(null);
    setStats(null);
    setSeeded(null);
    setCleared(null);
    setTjw(null);
  }

  // New-algorithm: assign all pending TJW in global request order (not per-day).
  function runTjw() {
    reset();
    startTransition(async () => {
      const res = await assignTjwByRequestOrder();
      if (!res.ok) { setError(res.error); return; }
      setTjw({ assigned: res.assigned, overflows: res.overflows });
      refresh();
    });
  }

  function run() {
    reset();
    const fd = new FormData();
    fd.set("date", date);
    startTransition(async () => {
      const res = await runBatchAction(fd);
      if (!res.ok) { setError(res.error); return; }
      if (res.stats) setStats(res.stats);
      refresh();
    });
  }

  function simulate() {
    reset();
    const fd = new FormData();
    fd.set("date", date);
    startTransition(async () => {
      const res = await simulateAndRunBatchAction(fd);
      if (!res.ok) { setError(res.error); return; }
      if (res.seededCount != null) setSeeded(res.seededCount);
      if (res.stats) setStats(res.stats);
      refresh();
    });
  }

  function clearDemo() {
    reset();
    const fd = new FormData();
    fd.set("date", date);
    startTransition(async () => {
      const res = await clearBatchDemoAction(fd);
      if (!res.ok) { setError(res.error); return; }
      if (res.clearedCount != null) setCleared(res.clearedCount);
      refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="batchDate" className="text-xs">{t("date")}</Label>
          <div className="w-48">
            <DateTimePicker
              name="batchDate"
              id="batchDate"
              dateOnly
              defaultValue={`${defaultDate}T00:00`}
              onChange={(v) => setDate(v || defaultDate)}
            />
          </div>
        </div>
        <Button type="button" onClick={run} disabled={pending}>
          {pending ? t("running") : t("run")}
        </Button>
        <Button type="button" variant="outline" onClick={simulate} disabled={pending}>
          {pending ? t("simulating") : t("simulate")}
        </Button>
        <Button type="button" variant="ghost" onClick={clearDemo} disabled={pending}>
          {t("clearDemo")}
        </Button>
        <Button type="button" variant="outline" onClick={runTjw} disabled={pending}>
          {t("assignTjw")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("simulateHelper")}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {seeded != null && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          {t("simulateSeeded", { count: seeded })}
        </p>
      )}
      {cleared != null && (
        <p className="text-xs text-muted-foreground">{t("clearedNote", { count: cleared })}</p>
      )}
      {tjw != null && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          {t("assignTjwDone", { count: tjw.assigned })}
          {tjw.overflows.length > 0 ? ` · ${tjw.overflows.length} overflow` : ""}
        </p>
      )}
      {stats && (
        <div className="rounded-md border bg-muted/40 p-3 text-xs">
          <p>
            {t("resultsSummary", {
              matched: stats.matchedCount,
              pending: stats.pendingCount,
            })}
          </p>
          {Object.keys(stats.overflowByReason).length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {Object.entries(stats.overflowByReason).map(([reason, n]) => (
                <li key={reason}>
                  <span className="font-mono">{reason}</span>: {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
