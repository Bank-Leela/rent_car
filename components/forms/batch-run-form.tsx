"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runBatchAction } from "@/lib/booking/batch-actions";

export function BatchRunForm({ defaultDate }: { defaultDate: string }) {
  const t = useTranslations("adminBatch");
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    pendingCount: number;
    matchedCount: number;
    overflowByReason: Record<string, number>;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        setStats(null);
        formData.set("date", date);
        startTransition(async () => {
          const res = await runBatchAction(formData);
          if (res && !res.ok) {
            setError(res.error);
            return;
          }
          if (res.ok && res.stats) setStats(res.stats);
          // Push the URL so the page re-renders for the chosen date.
          router.replace(`/admin/batch?date=${date}`);
          router.refresh();
        });
      }}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="batchDate" className="text-xs">{t("date")}</Label>
          <Input
            id="batchDate"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? t("running") : t("run")}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
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
    </form>
  );
}
