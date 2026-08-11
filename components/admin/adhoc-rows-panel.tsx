"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addAdHocRowAction, removeAdHocRowAction } from "@/lib/booking/adhoc-actions";

export type AdHocPanelRow = {
  id: string;
  label: string;
  cost: string | null;
  trips: { id: string; timeLabel: string; place: string }[];
};

/**
 * Outside vehicles hired for one day, on the rounds board.
 *
 * These already existed, but only on the drag-and-drop timeline — which is not
 * the view P'Top lands on, so in practice the feature was invisible. This is the
 * same `AdHocVehicle` data and the same server actions, rendered in the
 * whiteboard's language: one row per hired vehicle, its trips beside it, sitting
 * directly under the fleet's own rows.
 *
 * Deliberately off-algorithm, like the timeline version: an outside vehicle has
 * no driver in the pool, takes no slot, and earns no fairness credit. Removing a
 * row returns its trips to the queue rather than deleting them.
 */
export function AdHocRowsPanel({ date, rows }: { date: string; rows: AdHocPanelRow[] }) {
  const t = useTranslations("scheduler");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [cost, setCost] = useState("");
  const [pending, start] = useTransition();

  const add = () => {
    if (!label.trim()) return;
    start(async () => {
      const fd = new FormData();
      fd.set("date", date);
      fd.set("label", label.trim());
      if (cost.trim()) fd.set("cost", cost.trim());
      await addAdHocRowAction(fd);
      setLabel("");
      setCost("");
      setAdding(false);
      router.refresh();
    });
  };

  const remove = (id: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", id);
      await removeAdHocRowAction(fd);
      router.refresh();
    });

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Truck className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t("externalRows")}
        </h2>
        {!adding && (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("addExternalRow")}
          </Button>
        )}
      </div>

      {adding && (
        <div className="flex flex-wrap items-end gap-2 border-b bg-muted/30 px-4 py-3">
          <Input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("externalNamePlaceholder")}
            aria-label={t("externalNamePlaceholder")}
            className="h-9 w-64"
          />
          <Input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            type="number"
            step="0.01"
            placeholder={t("externalCostPlaceholder")}
            aria-label={t("externalCostPlaceholder")}
            className="h-9 w-36"
          />
          <Button type="button" size="sm" disabled={pending || !label.trim()} onClick={add}>
            {t("addExternalRow")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setAdding(false)}>
            {t("externalCancel")}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">{t("externalRowsEmptyRounds")}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:gap-4">
              {/* Same fixed-width identity column as the driver rows above, so the
                  two lists read as one board rather than two lists. */}
              <div className="flex shrink-0 items-start gap-2 sm:w-56">
                <span className="truncate text-sm font-semibold">{r.label}</span>
                {r.cost && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                    ฿{r.cost}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {r.trips.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t("roundsFree")}</span>
                ) : (
                  r.trips.map((tr) => (
                    <Link
                      key={tr.id}
                      href={`/admin/${tr.id}`}
                      className="rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800/70 dark:hover:bg-zinc-800"
                    >
                      <span className="font-medium tabular-nums">{tr.timeLabel}</span>{" "}
                      <span className="text-muted-foreground">{tr.place}</span>
                    </Link>
                  ))
                )}
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(r.id)}
                title={t("removeExternalRow")}
                aria-label={t("removeExternalRow")}
                className="shrink-0 self-start rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
