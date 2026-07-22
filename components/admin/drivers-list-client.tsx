"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { Users, ChevronRight, IdCard, CalendarClock, Trash2 } from "lucide-react";
import { ListSearch } from "@/components/list-search";
import { EmptyState } from "@/components/empty-state";
import type { LicenseStatus, RetirementStatus } from "@/lib/admin/roster-alerts";
import { adminRemoveDriverAction } from "@/lib/admin/driver-actions";
import { useActionToast } from "@/components/hooks/use-action-toast";

export interface DriverRow {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  vehicle: string | null;
  isActive: boolean;
  licenseType: string | null;
  licenseNumber: string | null;
  licenseExpiresAt: string | null; // ISO — serialized across the RSC boundary
  licenseState: LicenseStatus;
  retirementYear: number | null;
  retirementState: RetirementStatus;
  position: string | null;
  notes: string | null;
}

const AMBER = "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300";
const RED = "bg-destructive/10 text-destructive";

export function DriversListClient({ drivers }: { drivers: DriverRow[] }) {
  const t = useTranslations("adminDrivers");
  const ts = useTranslations("listSearch");
  return (
    <ListSearch
      items={drivers}
      keys={["name", "nickname", "phone", "vehicle"]}
      render={(rows) =>
        rows.length === 0 ? (
          <EmptyState icon={Users} title={ts("noMatches")} />
        ) : (
          <ul className="divide-y">
            {rows.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <Link
                  href={`/admin/drivers/${d.id}`}
                  className="flex flex-1 items-center justify-between gap-3 py-3 hover:opacity-90"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      <span>
                        {d.name}
                        {d.nickname ? <span className="text-muted-foreground"> ({d.nickname})</span> : null}
                      </span>
                      {!d.isActive && (
                        <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-destructive">
                          {t("inactiveBadge")}
                        </span>
                      )}
                      {d.licenseState === "expired" && d.licenseExpiresAt && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${RED}`}>
                          <IdCard className="h-3 w-3" aria-hidden />
                          {t("licenseExpired", { date: format(new Date(d.licenseExpiresAt), "d MMM yyyy") })}
                        </span>
                      )}
                      {d.licenseState === "expiring" && d.licenseExpiresAt && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${AMBER}`}>
                          <IdCard className="h-3 w-3" aria-hidden />
                          {t("licenseExpiring", { date: format(new Date(d.licenseExpiresAt), "d MMM yyyy") })}
                        </span>
                      )}
                      {(d.retirementState === "due" || d.retirementState === "soon") && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            d.retirementState === "due" ? RED : AMBER
                          }`}
                        >
                          <CalendarClock className="h-3 w-3" aria-hidden />
                          {t("retirementBadge", { year: d.retirementYear ?? 0 })}
                        </span>
                      )}
                    </div>
                    <div className="space-x-2 text-xs text-muted-foreground">
                      <span>{d.phone ?? t("noPhone")}</span>
                      <span>·</span>
                      <span>{d.vehicle ?? t("noVehicle")}</span>
                      {d.retirementYear != null && d.retirementState === "ok" && (
                        <>
                          <span>·</span>
                          <span>{t("retirementInfo", { year: d.retirementYear })}</span>
                        </>
                      )}
                    </div>
                    {d.notes && (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground/80" title={d.notes}>
                        {d.notes}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
                <RemoveDriverButton id={d.id} name={d.name} />
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

// Two-step remove: first click arms a confirm button (matches the deny/cancel
// pattern elsewhere) so a driver is never deleted on a single stray click.
function RemoveDriverButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("adminDrivers");
  const te = useTranslations("errors");
  const router = useRouter();
  const { toastResult } = useActionToast();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    const fd = new FormData();
    fd.set("driverId", id);
    startTransition(async () => {
      const res = await adminRemoveDriverAction(fd);
      toastResult(res.ok ? res : { ok: false, error: te(res.error) }, { success: t("removed") });
      if (res.ok) {
        setConfirm(false);
        router.refresh();
      }
    });
  }

  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        aria-label={t("removeDriverAria", { name })}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="inline-flex h-9 items-center rounded-md border border-destructive/40 bg-destructive/10 px-2 text-xs font-medium text-destructive hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {pending ? "…" : t("confirmRemove")}
      </button>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        disabled={pending}
        className="inline-flex h-9 items-center rounded-md border px-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("cancelRemove")}
      </button>
    </span>
  );
}
