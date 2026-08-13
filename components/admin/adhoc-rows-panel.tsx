"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { CalendarPlus, Phone, Plus, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBaht } from "@/lib/format-money";
import {
  addAdHocRowAction,
  removeAdHocRowAction,
  outsourceToRowAction,
  setAdHocContactAction,
  carryVendorToSeriesAction,
} from "@/lib/booking/adhoc-actions";

export type AdHocPanelRow = {
  id: string;
  label: string;
  cost: string | null;
  /** Who the passengers ring. `label` is the company or vehicle; this is the person. */
  contactName: string | null;
  contactPhone: string | null;
  trips: {
    id: string;
    timeLabel: string;
    place: string;
    /**
     * Later occurrences of this trip's series that still have no vehicle.
     *
     * Attaching a trip carries the vendor forward automatically, but a trip
     * attached before that existed — or attached while the later dates were not
     * yet approved — leaves its siblings behind. This is how the board offers to
     * catch them up, instead of the admin repeating the setup date by date.
     */
    strandedSiblings: number;
  }[];
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
      const res = (await outsourceToRowAction(fd)) as { ok: boolean; carriedForward?: number };
      // A recurring booking carries this vendor to its later dates, creating a
      // row on each. That happens on days the admin is not looking at, so it has
      // to be said out loud rather than discovered later.
      if (res?.ok && (res.carriedForward ?? 0) > 0) {
        toast.success(t("externalCarriedForward", { count: res.carriedForward! }));
      }
      router.refresh();
    });

  const carryToSeries = (bookingId: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("bookingId", bookingId);
      const res = (await carryVendorToSeriesAction(fd)) as { ok: boolean; carriedForward?: number };
      if (res?.ok) {
        const n = res.carriedForward ?? 0;
        // Say nothing happened rather than flashing a success on a no-op: by the
        // time the click lands, another admin may have arranged those dates.
        if (n > 0) toast.success(t("externalCarriedForward", { count: n }));
        else toast.info(t("externalCarryNothingLeft"));
      }
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
            <li key={r.id} className="flex flex-col gap-2 p-3">
             <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
              {/* Same fixed-width identity column as the driver rows above, so the
                  two lists read as one board rather than two lists. */}
              <div className="flex min-w-0 shrink-0 flex-col gap-1 sm:w-56">
                <div className="flex min-w-0 items-start gap-2">
                  <span className="truncate text-sm font-semibold">{r.label}</span>
                  {r.cost && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                      {formatBaht(r.cost)}
                    </span>
                  )}
                </div>
                {/* The contact sits under the vendor name, not beside the trips —
                    it belongs to the vehicle, not to any one trip on it.
                    min-w-0 on both this column and the button: `truncate` only
                    clips when every flex ancestor is allowed to shrink below its
                    content, otherwise a long vendor + phone widens the column. */}
                <button
                  type="button"
                  onClick={() => openEdit(r)}
                  className="flex min-w-0 items-center gap-1 self-start rounded text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {r.trips.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t("roundsFree")}</span>
                ) : (
                  r.trips.map((tr) => (
                    <span key={tr.id} className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/admin/${tr.id}`}
                        className="rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800/70 dark:hover:bg-zinc-800"
                      >
                        <span className="font-medium tabular-nums">{tr.timeLabel}</span>{" "}
                        <span className="text-muted-foreground">{tr.place}</span>
                      </Link>
                      {tr.strandedSiblings > 0 && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={pending}
                          onClick={() => carryToSeries(tr.id)}
                        >
                          <CalendarPlus className="h-3 w-3" aria-hidden />
                          {t("externalCarryToSeries", { count: tr.strandedSiblings })}
                        </Button>
                      )}
                    </span>
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
             </div>

             {/* The editor spans the whole row rather than living inside the
                 224 px identity column: two inputs plus two buttons need about
                 250 px, so nested there it wrapped onto three lines and pushed
                 the trips out of alignment with the driver rows above. */}
             {editing === r.id && (
               <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/40 p-2">
                 <Input
                   autoFocus
                   value={editDriver}
                   onChange={(e) => setEditDriver(e.target.value)}
                   placeholder={t("externalContactNamePlaceholder")}
                   aria-label={t("externalContactNamePlaceholder")}
                   className="h-8 w-full text-xs sm:w-40"
                 />
                 <Input
                   value={editPhone}
                   onChange={(e) => setEditPhone(e.target.value)}
                   type="tel"
                   inputMode="tel"
                   placeholder={t("externalContactPhonePlaceholder")}
                   aria-label={t("externalContactPhonePlaceholder")}
                   className="h-8 w-full text-xs sm:w-40"
                 />
                 <Button type="button" size="sm" disabled={pending} onClick={() => saveContact(r.id)}>
                   {t("externalContactSave")}
                 </Button>
                 <Button
                   type="button"
                   size="sm"
                   variant="ghost"
                   disabled={pending}
                   onClick={() => setEditing(null)}
                 >
                   {t("externalCancel")}
                 </Button>
               </div>
             )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
