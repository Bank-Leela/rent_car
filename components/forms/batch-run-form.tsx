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
  simulate30DaysAction,
  type ThirtyDaySummary,
} from "@/lib/booking/batch-demo-actions";
import { assignTjwByRequestOrder } from "@/lib/booking/tjw-request-actions";
import { useActionToast } from "@/components/hooks/use-action-toast";

type Stats = {
  pendingCount: number;
  matchedCount: number;
  overflowByReason: Record<string, number>;
};

export function BatchRunForm({ defaultDate }: { defaultDate: string }) {
  const t = useTranslations("adminBatch");
  const tt = useTranslations("toast");
  const { toastResult } = useActionToast();
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);
  const [cleared, setCleared] = useState<number | null>(null);
  const [tjw, setTjw] = useState<{ assigned: number; overflows: { reason: string }[] } | null>(null);
  const [sim30, setSim30] = useState<ThirtyDaySummary | null>(null);
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
    setSim30(null);
  }

  // 30-day fuzz: random month → ตจว-first pipeline → invariant check.
  function simulate30() {
    reset();
    const fd = new FormData();
    fd.set("date", date);
    startTransition(async () => {
      const res = await simulate30DaysAction(fd);
      toastResult(res, { success: tt("batchDone") });
      if (!res.ok) { setError(res.error); return; }
      if (res.summary) setSim30(res.summary);
      refresh();
    });
  }

  // New-algorithm: assign all pending TJW in global request order (not per-day).
  function runTjw() {
    reset();
    startTransition(async () => {
      const res = await assignTjwByRequestOrder();
      toastResult(res, { success: tt("tjwAssigned") });
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
      toastResult(res, { success: tt("batchDone") });
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
      toastResult(res, { success: tt("batchDone") });
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
        <Button type="button" variant="outline" onClick={simulate30} disabled={pending}>
          {pending ? t("simulating") : t("simulate30")}
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
      {sim30 && (
        <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
          <p className="font-medium">{t("simulate30Title", { days: sim30.days })}</p>
          <p>
            {t("simulate30Totals", {
              seeded: sim30.seededCount,
              tjw: sim30.tjwAssigned,
              nowait: sim30.noWaitCount,
              matched: sim30.totals.matched,
              overflow: sim30.totals.overflow,
            })}
          </p>
          <p>
            {t("simulate30Fairness", { spread: sim30.fairness.spread, stddev: sim30.fairness.stddev })} · seed{" "}
            <span className="font-mono">{sim30.seed}</span>
          </p>
          {sim30.ruleViolations.length === 0 ? (
            <p className="font-medium text-emerald-700 dark:text-emerald-400">{t("simulate30Clean")}</p>
          ) : (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2">
              <p className="font-medium text-destructive">
                {t("simulate30Violations", { count: sim30.ruleViolations.length, seed: sim30.seed })}
              </p>
              <ul className="mt-1 space-y-0.5">
                {sim30.ruleViolations.slice(0, 10).map((v, i) => (
                  <li key={i} className="font-mono">
                    <span className="font-semibold">{v.type}</span> {v.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
            {sim30.perDay.map((d) => (
              <li key={d.date} className="font-mono tabular-nums">
                {d.date}: {d.matched}✓{d.overflow > 0 ? ` ${d.overflow}⚠` : ""}
              </li>
            ))}
          </ul>
        </div>
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
