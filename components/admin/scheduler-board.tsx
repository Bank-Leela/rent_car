"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car, Wand2, GripVertical } from "lucide-react";
import { matchBookingAction } from "@/lib/booking/matching-actions";
import { reassignVehicleAction } from "@/lib/booking/schedule-actions";

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
  startHour: number;
  endHour: number;
  vehicleId: string | null;
  driverName: string | null;
};

const DAY_START = 6;
const DAY_END = 20;
const DAY_HOURS = DAY_END - DAY_START;
const HOURS = Array.from({ length: DAY_HOURS + 1 }, (_, i) => DAY_START + i);
const pct = (h: number) => Math.max(0, Math.min(1, (h - DAY_START) / DAY_HOURS)) * 100;

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
  const [dragOver, setDragOver] = useState<string | null>(null);

  const queue = bookings.filter((b) => !b.vehicleId);
  const onVehicle = (vehicleId: string) => bookings.filter((b) => b.vehicleId === vehicleId);

  function reassign(bookingId: string, vehicleId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("bookingId", bookingId);
      fd.append("vehicleId", vehicleId);
      await reassignVehicleAction(fd);
      router.refresh();
    });
  }

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

  const onDragStart = (id: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const block = (b: SchedulerBooking) => {
    const left = pct(b.startHour);
    const width = Math.max(pct(b.endHour) - left, 4);
    return (
      <div
        key={b.id}
        draggable
        onDragStart={onDragStart(b.id)}
        title={`${b.jobNumber} · ${b.timeLabel} · ${b.purpose} → ${b.destination}`}
        className="group absolute inset-y-1 cursor-grab overflow-hidden rounded-md border bg-card px-2 py-1 text-[11px] shadow-sm transition-shadow hover:z-10 hover:shadow-md active:cursor-grabbing"
        style={{ left: `${left}%`, width: `${width}%` }}
      >
        <div className="flex items-center gap-1 font-medium">
          <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          {b.timeLabel}
        </div>
        <div className="truncate text-muted-foreground">{b.purpose}</div>
        {b.driverName && <div className="truncate text-[10px] font-medium text-primary">{b.driverName}</div>}
      </div>
    );
  };

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

      {/* Unassigned queue — drag a card onto a car row to assign it. */}
      <div className="rounded-xl border bg-muted/30 p-3">
        <h2 className="mb-2 text-sm font-semibold">
          {t("queue")} <span className="text-muted-foreground">({queue.length})</span>
        </h2>
        {queue.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("queueEmpty")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {queue.map((b) => (
              <div
                key={b.id}
                draggable
                onDragStart={onDragStart(b.id)}
                title={`${b.jobNumber} · ${b.timeLabel} · ${b.purpose}`}
                className="w-56 cursor-grab rounded-md border bg-card p-2 text-xs shadow-sm active:cursor-grabbing"
              >
                <div className="flex items-center gap-1">
                  <GripVertical className="h-3 w-3 text-muted-foreground" aria-hidden />
                  <span className="font-mono text-[10px] text-muted-foreground">{b.jobNumber}</span>
                  <span className="font-medium">{b.timeLabel}</span>
                </div>
                <div className="truncate text-muted-foreground">{b.purpose} → {b.destination}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timeline: cars = rows, time on the X-axis. Drop a card on a row to assign its car. */}
      {vehicles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noVehicles")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <div className="min-w-[56rem]">
            {/* hour header */}
            <div className="flex border-b bg-muted/30">
              <div className="w-40 shrink-0" />
              <div className="relative h-6 flex-1">
                {HOURS.map((h) => (
                  <span
                    key={h}
                    className="absolute -translate-x-1/2 text-[10px] text-muted-foreground"
                    style={{ left: `${pct(h)}%`, top: "4px" }}
                  >
                    {h}:00
                  </span>
                ))}
              </div>
            </div>

            {/* car rows */}
            {vehicles.map((v) => (
              <div key={v.id} className="flex border-b last:border-b-0">
                <div className="flex w-40 shrink-0 items-center gap-2 px-2 py-2 text-sm font-medium">
                  <Car className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{v.registrationNumber}</span>
                  {v.isDutyVehicle && (
                    <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      {t("duty")}
                    </span>
                  )}
                </div>
                <div
                  className={`relative h-16 flex-1 transition-colors ${dragOver === v.id ? "bg-primary/10" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOver !== v.id) setDragOver(v.id);
                  }}
                  onDragLeave={() => setDragOver((cur) => (cur === v.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(null);
                    const id = e.dataTransfer.getData("text/plain");
                    if (id) reassign(id, v.id);
                  }}
                >
                  {HOURS.slice(1).map((h) => (
                    <div
                      key={h}
                      aria-hidden
                      className="absolute inset-y-0 w-px bg-border/60"
                      style={{ left: `${pct(h)}%` }}
                    />
                  ))}
                  {onVehicle(v.id).map(block)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
