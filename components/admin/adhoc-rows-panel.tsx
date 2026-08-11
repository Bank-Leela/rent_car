"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Phone, Plus, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addAdHocRowAction,
  removeAdHocRowAction,
  outsourceToRowAction,
  setAdHocContactAction,
} from "@/lib/booking/adhoc-actions";

export type AdHocPanelRow = {
  id: string;
  label: string;
  cost: string | null;
  /** Who the passengers ring. `label` is the company or vehicle; this is the person. */
  contactName: string | null;
  contactPhone: string | null;
  trips: { id: string; timeLabel: string; place: string }[];
};

export type WaitingTrip = { id: string; timeLabel: string; place: string; purpose: string };

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
export function AdHocRowsPanel({
  date,
  rows,
  waiting = [],
}: {
  date: string;
  rows: AdHocPanelRow[];
  /**
   * Trips already approved onto an outside rental but not yet on any row.
   *
   * Approving a full day for a requester who accepted an outside vehicle sets
   * status OUTSOURCED with no `adHocVehicleId`, and every board query reaches
   * outsourced trips only THROUGH a row — so these were invisible here, on the
   * one screen where the vendor actually gets booked.
   */
  waiting?: WaitingTrip[];
}) {
  const t = useTranslations("scheduler");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [cost, setCost] = useState("");
  const [driver, setDriver] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();
  // Which row's contact is being edited. A row is usually created before the
  // vendor says who is driving, so the contact has to be fillable afterwards —
  // deleting and re-adding the row would un-outsource every trip on it.
  const [editing, setEditing] = useState<string | null>(null);
  const [editDriver, setEditDriver] = useState("");
  const [editPhone, setEditPhone] = useState("");

  const add = () => {
    if (!label.trim()) return;
    start(async () => {
      const fd = new FormData();
      fd.set("date", date);
      fd.set("label", label.trim());
      if (cost.trim()) fd.set("cost", cost.trim());
      if (driver.trim()) fd.set("contactName", driver.trim());
      if (phone.trim()) fd.set("contactPhone", phone.trim());
      await addAdHocRowAction(fd);
      setLabel("");
      setCost("");
      setDriver("");
      setPhone("");
      setAdding(false);
      router.refresh();
    });
  };

  const openEdit = (r: AdHocPanelRow) => {
    setEditing(r.id);
    setEditDriver(r.contactName ?? "");
    setEditPhone(r.contactPhone ?? "");
  };

  const saveContact = (id: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("contactName", editDriver.trim());
      fd.set("contactPhone", editPhone.trim());
      await setAdHocContactAction(fd);
      setEditing(null);
      router.refresh();
    });

  const attach = (bookingId: string, rowId: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("bookingId", bookingId);
      fd.set("rowId", rowId);
      await outsourceToRowAction(fd);
      router.refresh();
    });

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
          <Input
            value={driver}
            onChange={(e) => setDriver(e.target.value)}
            placeholder={t("externalContactNamePlaceholder")}
            aria-label={t("externalContactNamePlaceholder")}
            className="h-9 w-40"
          />
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            placeholder={t("externalContactPhonePlaceholder")}
            aria-label={t("externalContactPhonePlaceholder")}
            className="h-9 w-40"
          />
          <Button type="button" size="sm" disabled={pending || !label.trim()} onClick={add}>
            {t("addExternalRow")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setAdding(false)}>
            {t("externalCancel")}
          </Button>
        </div>
      )}

      {/* Approved for an outside vehicle, no vendor picked yet. Shown above the
          rows because it is the outstanding work: until one of these is on a
          row, nobody has actually hired anything. */}
      {waiting.length > 0 && (
        <div className="border-b bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
          <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
            {t("externalWaitingTitle", { count: waiting.length })}
          </p>
          <ul className="mt-2 space-y-2">
            {waiting.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="tabular-nums text-amber-900 dark:text-amber-200">{w.timeLabel}</span>
                <span className="min-w-0 truncate text-amber-900 dark:text-amber-200">
                  {w.purpose} · {w.place}
                </span>
                {rows.length === 0 ? (
                  // Nothing to attach it to yet — say so rather than showing an
                  // empty row of buttons that looks broken.
                  <span className="text-amber-800 dark:text-amber-300">{t("externalWaitingNeedsRow")}</span>
                ) : (
                  rows.map((r) => (
                    <Button
                      key={r.id}
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={pending}
                      onClick={() => attach(w.id, r.id)}
                    >
                      {t("externalWaitingAssign", { row: r.label })}
                    </Button>
                  ))
                )}
              </li>
            ))}
          </ul>
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
              <div className="flex shrink-0 flex-col gap-1 sm:w-56">
                <div className="flex items-start gap-2">
                  <span className="truncate text-sm font-semibold">{r.label}</span>
                  {r.cost && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                      ฿{r.cost}
                    </span>
                  )}
                </div>
                {/* The contact sits under the vendor name, not beside the trips —
                    it belongs to the vehicle, not to any one trip on it. */}
                {editing === r.id ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Input
                      autoFocus
                      value={editDriver}
                      onChange={(e) => setEditDriver(e.target.value)}
                      placeholder={t("externalContactNamePlaceholder")}
                      aria-label={t("externalContactNamePlaceholder")}
                      className="h-7 w-28 text-xs"
                    />
                    <Input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      type="tel"
                      inputMode="tel"
                      placeholder={t("externalContactPhonePlaceholder")}
                      aria-label={t("externalContactPhonePlaceholder")}
                      className="h-7 w-32 text-xs"
                    />
                    <Button type="button" size="xs" disabled={pending} onClick={() => saveContact(r.id)}>
                      {t("externalContactSave")}
                    </Button>
                    <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => setEditing(null)}>
                      {t("externalCancel")}
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="flex items-center gap-1 self-start rounded text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Phone className="h-3 w-3 shrink-0" aria-hidden />
                    {r.contactPhone || r.contactName ? (
                      <span className="truncate">
                        {[r.contactName, r.contactPhone].filter(Boolean).join(" · ")}
                      </span>
                    ) : (
                      // Named as the missing thing, so a row without a contact
                      // reads as unfinished rather than as having none.
                      <span className="text-amber-700 dark:text-amber-400">{t("externalContactAdd")}</span>
                    )}
                  </button>
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
