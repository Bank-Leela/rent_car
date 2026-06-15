"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car, Wand2, GripVertical, AlertTriangle } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { matchBookingAction } from "@/lib/booking/matching-actions";
import { reassignVehicleAction } from "@/lib/booking/schedule-actions";

export type SchedulerVehicle = {
  id: string;
  registrationNumber: string;
  // car=driver: the car's fixed driver. null only for an unpaired car.
  driverName: string | null;
};

// Cars are shown as A, B, C… (index → letter) instead of plate numbers.
const carLabel = (i: number) => String.fromCharCode(65 + i);

export type SchedulerBooking = {
  id: string;
  jobNumber: string;
  purpose: string;
  destination: string;
  timeLabel: string;
  startHour: number;
  endHour: number;
  vehicleId: string | null;
  hasDriver: boolean;
  driverName: string | null;
  secondaryDriverName: string | null;
};

// The axis spans the full day, 00:00–24:00. (Kept as min/max bounds so a stray
// out-of-range value can never clamp a block off-screen.)
const DEFAULT_START = 0;
const DEFAULT_END = 24;
// Small gutter on each side so the 00:00 / 24:00 edge labels (and end-of-day
// blocks) don't collide with the rounded frame. Labels, gridlines, and blocks
// all map through this, so they stay aligned.
const AXIS_PAD = 3;
const pctOf = (h: number, start: number, hours: number) => {
  const f = Math.max(0, Math.min(1, (h - start) / hours));
  return AXIS_PAD + f * (100 - 2 * AXIS_PAD);
};

// A timeline block: absolutely positioned by exact minute (startHour carries
// minutes/60), draggable via @dnd-kit. The source dims while a DragOverlay
// clone follows the cursor — smooth, no native-DnD jank.
function TimelineBlock({
  b,
  noDriverLabel,
  dayStart,
  dayHours,
}: {
  b: SchedulerBooking;
  noDriverLabel: string;
  dayStart: number;
  dayHours: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: b.id });
  const left = pctOf(b.startHour, dayStart, dayHours);
  // True size: a short trip stays a small sliver (5 min ≈ 0.6% of the track);
  // 1.2% floor keeps a tiny job hoverable.
  const width = Math.max(pctOf(b.endHour, dayStart, dayHours) - left, 1.2);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`${b.jobNumber} · ${b.timeLabel} · ${b.purpose} → ${b.destination}`}
      className={`group absolute inset-y-1 cursor-grab touch-none overflow-hidden rounded-md bg-card px-2 py-1 text-left text-[11px] shadow-sm transition-shadow hover:z-10 hover:shadow-md active:cursor-grabbing ${
        b.hasDriver ? "border" : "border-2 border-destructive/60"
      }`}
      style={{ left: `${left}%`, width: `${width}%`, opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-center gap-1 font-medium">
        <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        {b.timeLabel}
      </div>
      <div className="truncate text-muted-foreground">{b.purpose}</div>
      {b.hasDriver ? (
        <div className="truncate text-[10px] font-medium text-primary">{b.driverName}</div>
      ) : (
        <div className="flex items-center gap-1 truncate text-[10px] font-medium text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
          {noDriverLabel}
        </div>
      )}
      {b.secondaryDriverName && (
        // Long-haul TJW (>400km) relief driver — preview of the car=driver "co-driver".
        <div className="truncate text-[10px] font-medium text-sky-600 dark:text-sky-400">+ {b.secondaryDriverName}</div>
      )}
    </div>
  );
}

// An unassigned-queue card (booking with no vehicle yet).
function QueueCard({ b }: { b: SchedulerBooking }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: b.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`${b.jobNumber} · ${b.timeLabel} · ${b.purpose}`}
      className="w-56 cursor-grab touch-none rounded-md border bg-card p-2 text-left text-xs shadow-sm active:cursor-grabbing"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-center gap-1">
        <GripVertical className="h-3 w-3 text-muted-foreground" aria-hidden />
        <span className="font-mono text-[10px] text-muted-foreground">{b.jobNumber}</span>
        <span className="font-medium">{b.timeLabel}</span>
      </div>
      <div className="truncate text-muted-foreground">
        {b.purpose} → {b.destination}
      </div>
    </div>
  );
}

// A car row = a droppable lane. Drop a card here to assign this car + a driver.
function CarRow({
  vehicle,
  label,
  isDuty,
  bookings,
  dutyLabel,
  noDriverLabel,
  dayStart,
  dayHours,
  hours,
}: {
  vehicle: SchedulerVehicle;
  label: string;
  isDuty: boolean;
  bookings: SchedulerBooking[];
  dutyLabel: string;
  noDriverLabel: string;
  dayStart: number;
  dayHours: number;
  hours: number[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: vehicle.id });
  return (
    <div className="flex border-b last:border-b-0">
      <div
        className="flex w-44 shrink-0 items-center gap-2 border-r px-3 py-2 text-sm font-medium"
        title={vehicle.registrationNumber}
      >
        <Car className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0">{label}</span>
        {vehicle.driverName ? (
          <span className="truncate text-xs font-normal text-muted-foreground">· {vehicle.driverName}</span>
        ) : (
          <span className="truncate text-[10px] font-normal text-destructive">· {noDriverLabel}</span>
        )}
        {isDuty && (
          <span className="ml-auto shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {dutyLabel}
          </span>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`relative h-16 flex-1 transition-colors ${isOver ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""}`}
      >
        {hours.map((h) => (
          <div
            key={h}
            aria-hidden
            className="absolute inset-y-0 w-px bg-border/40"
            style={{ left: `${pctOf(h, dayStart, dayHours)}%` }}
          />
        ))}
        {bookings.map((b) => (
          <TimelineBlock key={b.id} b={b} noDriverLabel={noDriverLabel} dayStart={dayStart} dayHours={dayHours} />
        ))}
      </div>
    </div>
  );
}

export function SchedulerBoard({
  vehicles,
  bookings,
  dutyVehicleId,
}: {
  vehicles: SchedulerVehicle[];
  bookings: SchedulerBooking[];
  dutyVehicleId: string | null;
}) {
  const t = useTranslations("scheduler");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ assigned: number; failures: string[] } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // 4px travel before a drag starts → a plain click still shows the title tooltip.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Auto-fit the axis: start no later than 06:00, end no earlier than 20:00,
  // but stretch to swallow an early/late trip. endHour === 24 is the overnight
  // sentinel (runs to the right edge) — excluded from the "latest real end".
  const realEnds = bookings.filter((b) => b.endHour < 24).map((b) => b.endHour);
  const dayStart = Math.max(0, Math.floor(Math.min(DEFAULT_START, ...bookings.map((b) => b.startHour))));
  const dayEnd = Math.min(24, Math.ceil(Math.max(DEFAULT_END, ...realEnds)));
  const dayHours = dayEnd - dayStart;
  const hours = Array.from({ length: dayHours + 1 }, (_, i) => dayStart + i);

  // Not fully assigned: missing a vehicle (queue) OR has a vehicle but no driver.
  const queue = bookings.filter((b) => !b.vehicleId);
  const needsDriver = bookings.filter((b) => b.vehicleId && !b.hasDriver);
  const work = [...queue, ...needsDriver];
  const onVehicle = (vehicleId: string) => bookings.filter((b) => b.vehicleId === vehicleId);
  const activeBooking = activeId ? bookings.find((b) => b.id === activeId) ?? null : null;

  function reassign(bookingId: string, vehicleId: string) {
    setDropError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("bookingId", bookingId);
      fd.append("vehicleId", vehicleId);
      const res = await reassignVehicleAction(fd);
      // car=driver: the drop lands the car + its driver. Blocks only on a busy
      // car or a car with no assigned driver.
      if (!res.ok) {
        const key = res.error === "vehicleBusy" ? "dropConflict" : res.error === "noAssignedDriver" ? "noAssignedDriver" : "dropFailed";
        setDropError(t(key));
      }
      router.refresh();
    });
  }

  function autoAssignAll() {
    if (work.length === 0) return;
    setResult(null);
    setDropError(null);
    startTransition(async () => {
      let assigned = 0;
      const failures: string[] = [];
      for (const b of work) {
        const fd = new FormData();
        fd.append("bookingId", b.id);
        let res;
        if (b.vehicleId) {
          fd.append("vehicleId", b.vehicleId); // already on a car → attach that car's driver
          res = await reassignVehicleAction(fd);
        } else {
          res = await matchBookingAction(fd);
        }
        if (res?.ok) assigned += 1;
        else failures.push(`${b.jobNumber}: ${res?.error ?? "error"}`);
      }
      setResult({ assigned, failures });
      router.refresh();
    });
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const over = e.over;
    if (over) reassign(String(e.active.id), String(over.id));
  }

  return (
    // id is REQUIRED: @dnd-kit derives the draggables' aria-describedby from it,
    // and without a stable value it falls back to a module counter that drifts
    // between SSR and client → hydration mismatch. Don't remove.
    <DndContext id="scheduler-board" sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
          <button
            type="button"
            onClick={autoAssignAll}
            disabled={pending || work.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" aria-hidden />
            {pending ? t("assigning") : t("autoAssign", { count: work.length })}
          </button>
        </div>

        {dropError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {dropError}
          </div>
        )}

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
                <QueueCard key={b.id} b={b} />
              ))}
            </div>
          )}
        </div>

        {/* Timeline: cars = rows, time on the X-axis. Drop a card on a row to assign its car + a free driver. */}
        {vehicles.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noVehicles")}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <div className="min-w-[64rem]">
              <div className="flex border-b bg-muted/30">
                <div className="w-44 shrink-0 border-r" />
                <div className="relative h-8 flex-1">
                  {hours.map((h) => (
                    // Every label centered on its tick. The AXIS_PAD gutter keeps
                    // 00:00 / 24:00 off the frame, so no edge anchoring is needed —
                    // and centering stops the ends colliding with 01:00 / 23:00.
                    <span
                      key={h}
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                      style={{ left: `${pctOf(h, dayStart, dayHours)}%` }}
                    >
                      {String(h).padStart(2, "0")}:00
                    </span>
                  ))}
                </div>
              </div>

              {vehicles.map((v, i) => (
                <CarRow
                  key={v.id}
                  vehicle={v}
                  label={carLabel(i)}
                  isDuty={v.id === dutyVehicleId}
                  bookings={onVehicle(v.id)}
                  dutyLabel={t("duty")}
                  noDriverLabel={t("noDriver")}
                  dayStart={dayStart}
                  dayHours={dayHours}
                  hours={hours}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating ghost that follows the cursor while dragging. */}
      <DragOverlay dropAnimation={null}>
        {activeBooking ? (
          <div className="pointer-events-none w-56 cursor-grabbing rounded-md border bg-card p-2 text-xs shadow-lg ring-2 ring-primary/50">
            <div className="flex items-center gap-1">
              <GripVertical className="h-3 w-3 text-muted-foreground" aria-hidden />
              <span className="font-mono text-[10px] text-muted-foreground">{activeBooking.jobNumber}</span>
              <span className="font-medium">{activeBooking.timeLabel}</span>
            </div>
            <div className="truncate text-muted-foreground">{activeBooking.purpose}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
