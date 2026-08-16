"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { th } from "date-fns/locale";
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

// "Needs attention soon" and "already a problem". AMBER was
// `bg-amber-100 text-amber-900` plus a dark: override — the hand-rolled urgency
// the --urgent trio exists to replace, and the audit named this line. The dark:
// override is deleted rather than translated: the tokens swap themselves.
const AMBER = "bg-urgent-surface text-urgent-foreground";
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
          // Cards, not hairline-divided rows. The requester log and the
          // timeline both give each row a surface and a leading plate; this list
          // was the last flat one, so six drivers read as one grey slab.
          <ul className="space-y-2">
            {rows.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-2 overflow-hidden rounded-xl border bg-card pr-2 shadow-e1"
              >
                <Link
                  href={`/admin/drivers/${d.id}`}
                  // ring-inset, not a plain outline: the li above gained `overflow-hidden`
                  // (needed to clip the hover wash to the rounded corners), and an
                  // outline paints OUTWARD from the border box, so it was being
                  // clipped away on three sides — keyboard focus on a driver row was
                  // invisible. requester-booking-list.tsx already does it this way.
                  className="flex flex-1 items-center justify-between gap-3 rounded-xl p-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  {/* State plate: the licence/retirement problem is legible before
                      you read a word, and it gives the row an anchor the way the
                      date plate does on the requester log. */}
                  <span
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-semibold ${
                      d.licenseState === "expired" || d.retirementState === "due"
                        ? "bg-destructive/10 text-destructive"
                        : d.licenseState === "expiring" || d.retirementState === "soon"
                          ? "bg-urgent-surface text-urgent-foreground"
                          : "bg-muted text-muted-foreground"
                    }`}
                    aria-hidden
                  >
                    {/* Name, not nickname: Thai nicknames here carry an honorific prefix
                        (พี่กอล์ฟ, น้าชู, พี่รง), so a nickname initial collapses to
                        พ or น for nearly everyone and distinguishes nothing. */}
                    {(d.name || d.nickname || "?").trim().charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
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
                          {t("licenseExpired", { date: format(new Date(d.licenseExpiresAt), "d MMM yyyy", { locale: th }) })}
                        </span>
                      )}
                      {d.licenseState === "expiring" && d.licenseExpiresAt && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${AMBER}`}>
                          <IdCard className="h-3 w-3" aria-hidden />
                          {t("licenseExpiring", { date: format(new Date(d.licenseExpiresAt), "d MMM yyyy", { locale: th }) })}
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
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        className="inline-flex h-11 items-center rounded-lg border border-destructive/40 bg-destructive/10 px-3 text-sm font-medium text-destructive hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {pending ? "…" : t("confirmRemove")}
      </button>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        disabled={pending}
        className="inline-flex h-11 items-center rounded-lg border px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("cancelRemove")}
      </button>
    </span>
  );
}
