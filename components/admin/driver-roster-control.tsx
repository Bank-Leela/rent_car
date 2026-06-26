"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UserX, UserCheck } from "lucide-react";
import { setDriverUnavailableAction } from "@/lib/booking/availability-actions";

export type RosterDriver = {
  driverId: string;
  name: string;
  carReg: string | null;
  off: boolean;
};

/**
 * Mark a driver off (sick / leave) for the viewed day, or bring them back. An
 * off driver is excluded from that day's auto-assign; fairness + rotation
 * self-heal on return.
 */
export function DriverRosterControl({
  drivers,
  date,
}: {
  drivers: RosterDriver[];
  date: string;
}) {
  const t = useTranslations("roster");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const offCount = drivers.filter((d) => d.off).length;

  function toggle(driverId: string, off: boolean) {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("driverId", driverId);
      fd.append("date", date);
      fd.append("off", String(off));
      await setDriverUnavailableAction(fd);
      router.refresh();
    });
  }

  return (
    <details className="rounded-md border bg-muted/30" open={offCount > 0}>
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
        {t("title")}
        {offCount > 0 ? ` · ${t("offCount", { count: offCount })}` : ""}
      </summary>
      <div className="flex flex-wrap gap-2 px-4 pt-2">
        {drivers.map((d) => (
          <button
            key={d.driverId}
            type="button"
            disabled={pending}
            onClick={() => toggle(d.driverId, !d.off)}
            aria-pressed={d.off}
            title={d.off ? t("markBack") : t("markOff")}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
              d.off
                ? "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
                : "cursor-pointer bg-background hover:bg-muted"
            }`}
          >
            {d.off ? (
              <UserX className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <UserCheck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            )}
            <span>
              {d.carReg ? `${d.carReg} · ` : ""}
              {d.name}
            </span>
            {d.off && <span className="text-xs">({t("off")})</span>}
          </button>
        ))}
      </div>
      <p className="px-4 pb-3 pt-2 text-xs text-muted-foreground">{t("hint")}</p>
    </details>
  );
}
