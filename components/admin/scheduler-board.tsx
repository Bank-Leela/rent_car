"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car, User, Wand2 } from "lucide-react";
import { matchBookingAction } from "@/lib/booking/matching-actions";
import { cn } from "@/lib/utils";

export type SchedulerVehicle = {
  id: string;
  registrationNumber: string;
  isDutyVehicle: boolean;
};

export type SchedulerBooking = {
  id: string;
  jobNumber: string;
  purpose: string;
  destination: string;
  timeLabel: string;
  half: "MORNING" | "AFTERNOON";
  vehicleId: string | null;
  driverName: string | null;
};

const HALVES = ["MORNING", "AFTERNOON"] as const;

export function SchedulerBoard({
  vehicles,
  bookings,
}: {
  vehicles: SchedulerVehicle[];
  bookings: SchedulerBooking[];
}) {
  const t = useTranslations("scheduler");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ assigned: number; failures: string[] } | null>(null);

  const queue = bookings.filter((b) => !b.vehicleId);
  const cellBookings = (vehicleId: string, half: string) =>
    bookings.filter((b) => b.vehicleId === vehicleId && b.half === half);

  // Fully auto: run the matcher over each unassigned request. The matcher
  // picks the vehicle (Algorithm 1) and the driver (rotation order) per
  // booking; sequential calls see prior assignments via the DB.
  function autoAssignAll() {
    if (queue.length === 0) return;
    setResult(null);
    startTransition(async () => {
      let assigned = 0;
      const failures: string[] = [];
      for (const b of queue) {
        const fd = new FormData();
        fd.append("bookingId", b.id);
        const res = await matchBookingAction(fd);
        if (res?.ok) assigned += 1;
        else failures.push(`${b.jobNumber}: ${res?.error ?? "error"}`);
      }
      setResult({ assigned, failures });
      router.refresh();
    });
  }

  const card = (b: SchedulerBooking) => (
    <div
      key={b.id}
      className="rounded-md border bg-card p-2 text-xs shadow-sm"
    >
      <div className="flex items-center gap-1">
        <span className="font-mono text-[10px] text-muted-foreground">{b.jobNumber}</span>
        <span className="font-medium">{b.timeLabel}</span>
      </div>
      <div className="truncate text-muted-foreground">
        {b.purpose} → {b.destination}
      </div>
      {b.driverName && (
        <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary">
          <User className="h-3 w-3" aria-hidden />
          {b.driverName}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        <button
          type="button"
          onClick={autoAssignAll}
          disabled={pending || queue.length === 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
        >
          <Wand2 className="h-4 w-4" aria-hidden />
          {pending ? t("assigning") : t("autoAssign", { count: queue.length })}
        </button>
      </div>

      {result && (
        <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-sm">
          <p className="font-medium">{t("resultSummary", { assigned: result.assigned, failed: result.failures.length })}</p>
          {result.failures.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {result.failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Unassigned queue */}
      <div className="rounded-xl border bg-muted/30 p-3">
        <h2 className="mb-2 text-sm font-semibold">
          {t("queue")} <span className="text-muted-foreground">({queue.length})</span>
        </h2>
        {queue.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("queueEmpty")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {queue.map((b) => (
              <div key={b.id} className="w-56">
                {card(b)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Vehicle × half grid (result visualization) */}
      {vehicles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noVehicles")}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-160 space-y-2">
            <div className="grid grid-cols-[10rem_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground">
              <div />
              <div className="px-1">{t("morning")}</div>
              <div className="px-1">{t("afternoon")}</div>
            </div>
            {vehicles.map((v) => (
              <div key={v.id} className="grid grid-cols-[10rem_1fr_1fr] gap-2 rounded-lg border p-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Car className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{v.registrationNumber}</span>
                  {v.isDutyVehicle && (
                    <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      {t("duty")}
                    </span>
                  )}
                </div>
                {HALVES.map((half) => (
                  <div key={half} className="min-h-12 space-y-1 rounded-md bg-muted/20 p-1">
                    {cellBookings(v.id, half).map(card)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
