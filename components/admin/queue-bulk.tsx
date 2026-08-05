"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DenyPresetChips } from "@/components/forms/deny-preset-chips";
import { approveBookingAction, denyByApproverAction } from "@/lib/booking/approval-actions";

// Bulk select-mode for the pending queue. The queue cards themselves stay
// server-rendered; this provider wraps them (as children) and the per-card
// BulkCheckbox client leaves share its context. Bulk approve/deny run the
// existing single-booking actions sequentially — per-booking failures are
// collected, never abort the batch.
type BulkCtx = {
  selectMode: boolean;
  selected: Set<string>;
  toggle: (id: string) => void;
};
const Ctx = createContext<BulkCtx>({ selectMode: false, selected: new Set(), toggle: () => {} });

export function QueueBulkProvider({
  children,
  filters,
  showToolbar = true,
}: {
  children: React.ReactNode;
  // The queue's filter row, rendered as the left of the same line as the bulk
  // controls: select-mode acts on exactly the rows those filters produce, so the
  // two belong together rather than stacked. A plain element, not a render prop
  // — this is a client component and the page rendering it is a server one.
  filters?: React.ReactNode;
  /** Hidden when the filtered queue is empty — nothing to select. */
  showToolbar?: boolean;
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [denyOpen, setDenyOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
    setDenyOpen(false);
    setReason("");
  };

  // Sequential on purpose: each action revalidates + emails; parallel writes
  // would just contend. Collect failures, report one summary toast.
  const runBulk = async (kind: "approve" | "deny") => {
    setBusy(true);
    let ok = 0;
    const failures: string[] = [];
    for (const id of selected) {
      const fd = new FormData();
      fd.set("bookingId", id);
      if (kind === "deny") fd.set("comment", reason);
      const res = kind === "approve" ? await approveBookingAction(fd) : await denyByApproverAction(fd);
      if (res.ok) ok += 1;
      else failures.push(res.error);
    }
    setBusy(false);
    if (failures.length === 0) toast.success(t("bulkDone", { ok, fail: 0 }));
    else toast.error(t("bulkDone", { ok, fail: failures.length }));
    exitSelect();
    router.refresh();
  };

  return (
    <Ctx.Provider value={{ selectMode, selected, toggle }}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {filters}
          <div className="ml-auto flex flex-wrap items-center gap-2">
          {!showToolbar ? null : !selectMode ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setSelectMode(true)}>
              <CheckSquare className="h-4 w-4" />
              {t("bulkSelect")}
            </Button>
          ) : (
            <>
              <span className="text-sm text-muted-foreground">{t("bulkSelected", { count: selected.size })}</span>
              <Button type="button" size="sm" disabled={busy || selected.size === 0} onClick={() => runBulk("approve")}>
                {busy ? t("bulkWorking") : t("bulkApprove", { count: selected.size })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy || selected.size === 0}
                onClick={() => setDenyOpen((v) => !v)}
              >
                {t("bulkDeny", { count: selected.size })}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={exitSelect}>
                {t("bulkCancel")}
              </Button>
            </>
          )}
          </div>
        </div>
        {selectMode && denyOpen && (
          <div className="space-y-2 rounded-xl border bg-card p-3 shadow-sm">
            <p className="text-xs text-muted-foreground">{t("bulkDenyHint")}</p>
            <DenyPresetChips onPick={setReason} />
            <Textarea
              aria-label={t("bulkDenyReason")}
              placeholder={t("bulkDenyReason")}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy || reason.trim().length < 3 || selected.size === 0}
              onClick={() => runBulk("deny")}
            >
              {busy ? t("bulkWorking") : t("bulkDenyConfirm", { count: selected.size })}
            </Button>
          </div>
        )}
        {children}
      </div>
    </Ctx.Provider>
  );
}

// Per-card checkbox, rendered only in select mode. Lives inside the (server
// rendered) card; shares state via context.
export function BulkCheckbox({ bookingId }: { bookingId: string }) {
  const { selectMode, selected, toggle } = useContext(Ctx);
  const t = useTranslations("admin");
  if (!selectMode) return null;
  const on = selected.has(bookingId);
  return (
    <button
      type="button"
      onClick={() => toggle(bookingId)}
      aria-pressed={on}
      aria-label={t("bulkPick")}
      className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {on ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}
    </button>
  );
}
