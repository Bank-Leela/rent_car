"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car, GripVertical } from "lucide-react";
import { assignBookingAction } from "@/lib/booking/actions";
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
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overVehicle, setOverVehicle] = useState<string | null>(null);

  const queue = bookings.filter((b) => !b.vehicleId);
  const cellBookings = (vehicleId: string, half: string) =>
    bookings.filter((b) => b.vehicleId === vehicleId && b.half === half);

  function assign(bookingId: string, vehicleId: string) {
    const current = bookings.find((b) => b.id === bookingId);
    if (!current || current.vehicleId === vehicleId) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("bookingId", bookingId);
      fd.append("vehicleId", vehicleId);
      const res = await assignBookingAction(fd);
      if (res && !res.ok) setError(res.error);
      else router.refresh();
    });
  }

  const card = (b: SchedulerBooking) => (
    <div
      key={b.id}
      draggable={!pending}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", b.id);
        e.dataTransfer.effectAllowed = "move";
        setDragId(b.id);
      }}
      onDragEnd={() => {
        setDragId(null);
        setOverVehicle(null);
      }}
      className={cn(
        "group flex cursor-grab items-start gap-1.5 rounded-md border bg-card p-2 text-xs shadow-sm active:cursor-grabbing",
        dragId === b.id && "opacity-50",
      )}
    >
      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-muted-foreground">{b.jobNumber}</span>
          <span className="font-medium">{b.timeLabel}</span>
        </div>
        <div className="truncate text-muted-foreground">
          {b.purpose} → {b.destination}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Unassigned queue */}
      <div
        className="rounded-xl border bg-muted/30 p-3"
        onDragOver={(e) => e.preventDefault()}
      >
        <h2 className="mb-2 text-sm font-semibold">
          {t("queue")} <span className="text-muted-foreground">({queue.length})</span>
        </h2>
        {queue.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("queueEmpty")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">{queue.map(card)}</div>
        )}
      </div>

      {/* Vehicle × half grid */}
      {vehicles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noVehicles")}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px] space-y-2">
            <div className="grid grid-cols-[10rem_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground">
              <div />
              <div className="px-1">{t("morning")}</div>
              <div className="px-1">{t("afternoon")}</div>
            </div>
            {vehicles.map((v) => (
              <div
                key={v.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverVehicle(v.id);
                }}
                onDragLeave={() => setOverVehicle((cur) => (cur === v.id ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  setOverVehicle(null);
                  if (id) assign(id, v.id);
                }}
                className={cn(
                  "grid grid-cols-[10rem_1fr_1fr] gap-2 rounded-lg border p-2 transition-colors",
                  overVehicle === v.id && "ring-2 ring-primary bg-primary/5",
                )}
              >
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
      <p className="text-xs text-muted-foreground">{t("dropHint")}</p>
    </div>
  );
}
