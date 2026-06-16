"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car, Wand2, GripVertical, AlertTriangle, Link2 } from "lucide-react";
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
import type { JobType } from "@prisma/client";
import { matchBookingAction } from "@/lib/booking/matching-actions";
import { reassignVehicleAction } from "@/lib/booking/schedule-actions";
import { AssignRecoButton } from "@/components/forms/assign-reco-button";

// Per-job-type colour, tuned for both light and dark themes. Fills + borders
// only — the conflict (red) and co-driver (violet) cues stay as rings so they
// never clash with these. TJW=ค้างคืน, OT=ล่วงเวลา, WERN=เวร, NORMAL=ทั่วไป.
const JOB_COLOR: Record<string, { block: string; dot: string; label: string }> = {
  TJW: {
    block: "bg-blue-50 border-blue-300 dark:bg-blue-950/50 dark:border-blue-700",
    dot: "bg-blue-500",
    label: "ค้างคืน · TJW",
  },
  OT: {
    block: "bg-amber-50 border-amber-300 dark:bg-amber-950/50 dark:border-amber-700",
    dot: "bg-amber-500",
    label: "ล่วงเวลา · OT",
  },
  WERN: {
    block: "bg-emerald-50 border-emerald-300 dark:bg-emerald-950/50 dark:border-emerald-700",
    dot: "bg-emerald-500",
    label: "เวร · WERN",
  },
  NORMAL: {
    block: "bg-slate-100 border-slate-300 dark:bg-slate-800/70 dark:border-slate-600",
    dot: "bg-slate-400",
    label: "ทั่วไป · NORMAL",
  },
};
const jobStyle = (jt: string) => JOB_COLOR[jt] ?? JOB_COLOR.NORMAL!;
const JOB_LEGEND = ["TJW", "OT", "WERN", "NORMAL"] as const;

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
  // Start as "HH:mm", or "↪ <date>" when the trip began on an earlier day.
  timeLabel: string;
  // End time as "HH:mm", with "↩ <return date>" when it ends on a later day.
  endLabel: string;
  startHour: number;
  endHour: number;
  // True when this trip spills past the viewed day's start/end (multi-day) — the
  // block is clamped to the axis and its clipped edge is rendered flush.
  continuesBefore: boolean;
  continuesAfter: boolean;
  vehicleId: string | null;
  jobType: JobType;
  // Recommended placement for an unassigned (queue) booking — fairest free car,
  // or the duty car (reclaim). null when assigned or none available.
  reco: { vehicleId: string; secondaryDriverId: string | null; label: string; assignLabel: string } | null;
  hasDriver: boolean;
  driverName: string | null;
  // Long-haul (>400km) co-driver: their name, id, and the car THEY are assigned
  // to (car=driver). The board paints a linked ghost on that car's row.
  secondaryDriverName: string | null;
  secondaryDriverId: string | null;
  secondaryVehicleId: string | null;
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

// Vertical geometry for stacking concurrent trips: each overlap lane is a sub-row
// of LANE_PX, with LANE_PAD breathing room top/bottom inside it.
const LANE_PX = 64;
const LANE_PAD = 4;

// A timeline block: absolutely positioned by exact minute (startHour carries
// minutes/60), draggable via @dnd-kit. The source dims while a DragOverlay
// clone follows the cursor — smooth, no native-DnD jank.
function TimelineBlock({
  b,
  noDriverLabel,
  dayStart,
  dayHours,
  top,
  height,
  conflict,
}: {
  b: SchedulerBooking;
  noDriverLabel: string;
  dayStart: number;
  dayHours: number;
  // Vertical placement within the car row: which stacked lane this block sits in.
  top: number;
  height: number;
  // Overlaps another trip on a car that is NOT allowed to overlap (non-duty).
  conflict: boolean;
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
      className={`group absolute cursor-grab touch-none overflow-hidden rounded-md border px-2 py-1 text-left text-[11px] shadow-sm transition-shadow hover:z-10 hover:shadow-md active:cursor-grabbing ${
        jobStyle(b.jobType).block
      } ${
        conflict
          ? "ring-2 ring-destructive"
          : b.secondaryDriverName
            ? "ring-1 ring-violet-400/70"
            : !b.hasDriver
              ? "ring-1 ring-destructive/70"
              : ""
      } ${b.continuesBefore ? "rounded-l-none border-l-4 border-l-foreground/40" : ""} ${
        b.continuesAfter ? "rounded-r-none border-r-4 border-r-foreground/40" : ""
      }`}
      style={{ left: `${left}%`, width: `${width}%`, top, height, opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-center gap-1 whitespace-nowrap font-medium">
        <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        {b.timeLabel}–{b.endLabel}
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
        // Long-haul (>400km) co-driver — the violet + link icon ties this block
        // to the matching ghost on the co-driver's own car row.
        <div className="flex items-center gap-1 truncate text-[10px] font-medium text-violet-600 dark:text-violet-400">
          <Link2 className="h-3 w-3 shrink-0" aria-hidden />
          {b.secondaryDriverName}
        </div>
      )}
    </div>
  );
}

// Read-only ghost painted on the CO-DRIVER's own car row for a long-haul trip.
// Their car isn't dispatched (they ride in the primary's), but the row shows
// they're out — same violet accent + link icon as the primary's block.
function CoDriverGhost({
  b,
  dayStart,
  dayHours,
  top,
  height,
  coDriverLabel,
}: {
  b: SchedulerBooking;
  dayStart: number;
  dayHours: number;
  top: number;
  height: number;
  coDriverLabel: string;
}) {
  const left = pctOf(b.startHour, dayStart, dayHours);
  const width = Math.max(pctOf(b.endHour, dayStart, dayHours) - left, 1.2);
  return (
    <div
      title={`${b.jobNumber} · ${b.timeLabel} · ${coDriverLabel}${b.driverName ? " → " + b.driverName : ""} · ${b.purpose}`}
      className={`absolute overflow-hidden rounded-md border border-dashed border-violet-400/70 bg-violet-50 px-2 py-1 text-left text-[11px] text-violet-900 dark:bg-violet-950/30 dark:text-violet-200 ${
        b.continuesBefore ? "rounded-l-none border-l-4" : ""
      } ${b.continuesAfter ? "rounded-r-none border-r-4" : ""}`}
      style={{ left: `${left}%`, width: `${width}%`, top, height }}
    >
      <div className="flex items-center gap-1 whitespace-nowrap font-medium">
        <Link2 className="h-3 w-3 shrink-0" aria-hidden />
        {b.timeLabel}–{b.endLabel}
      </div>
      <div className="truncate text-[10px] font-medium">{coDriverLabel}</div>
      {b.driverName && (
        <div className="truncate text-[10px] text-violet-700 dark:text-violet-300">→ {b.driverName}</div>
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
      className={`w-56 cursor-grab touch-none rounded-md border p-2 text-left text-xs shadow-sm active:cursor-grabbing ${jobStyle(b.jobType).block}`}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-center gap-1">
        <GripVertical className="h-3 w-3 text-muted-foreground" aria-hidden />
        <span className={`h-2 w-2 shrink-0 rounded-full ${jobStyle(b.jobType).dot}`} aria-hidden />
        <span className="font-mono text-[10px] text-muted-foreground">{b.jobNumber}</span>
        <span className="font-medium">{b.timeLabel}–{b.endLabel}</span>
      </div>
      <div className="truncate text-muted-foreground">
        {b.purpose} → {b.destination}
      </div>
      {b.reco && (
        // Recommended placement + one-click assign. Stop pointer propagation so
        // tapping the button doesn't start a drag.
        <div
          className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-muted-foreground">💡 {b.reco.label}</span>
          <AssignRecoButton
            bookingId={b.id}
            vehicleId={b.reco.vehicleId}
            secondaryDriverId={b.reco.secondaryDriverId}
            label={b.reco.assignLabel}
          />
        </div>
      )}
    </div>
  );
}

// A car row = a droppable lane. Drop a card here to assign this car + a driver.
function CarRow({
  vehicle,
  label,
  isDuty,
  bookings,
  coDriverBookings,
  dutyLabel,
  noDriverLabel,
  coDriverLabel,
  dayStart,
  dayHours,
  hours,
}: {
  vehicle: SchedulerVehicle;
  label: string;
  isDuty: boolean;
  bookings: SchedulerBooking[];
  // Long-haul trips where THIS car's driver rides as co-driver (painted as ghosts).
  coDriverBookings: SchedulerBooking[];
  dutyLabel: string;
  noDriverLabel: string;
  coDriverLabel: string;
  dayStart: number;
  dayHours: number;
  hours: number[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: vehicle.id });

  // Row items = the car's own trips (draggable) + co-driver ghosts (read-only).
  // Both occupy time, so both feed the lane packing.
  type RowItem = {
    key: string;
    b: SchedulerBooking;
    kind: "primary" | "co";
    startHour: number;
    endHour: number;
  };
  const items: RowItem[] = [
    ...bookings.map((b) => ({ key: b.id, b, kind: "primary" as const, startHour: b.startHour, endHour: b.endHour })),
    ...coDriverBookings.map((b) => ({ key: `co-${b.id}`, b, kind: "co" as const, startHour: b.startHour, endHour: b.endHour })),
  ];

  // Greedy lane packing: an item joins the first lane whose last item ends at or
  // before it starts, else opens a new lane. Concurrent items land on separate
  // stacked lanes so none is hidden behind another.
  const sorted = [...items].sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const it of sorted) {
    let lane = laneEnds.findIndex((end) => end <= it.startHour);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.endHour);
    } else {
      laneEnds[lane] = it.endHour;
    }
    laneOf.set(it.key, lane);
  }
  const laneCount = Math.max(1, laneEnds.length);

  // Flag PRIMARY trips that overlap another primary on this car. Only shown red
  // on a non-duty car — the duty (WERN) car is allowed to overlap. Co-driver
  // ghosts are ride-alongs and never count as conflicts.
  const primaries = sorted.filter((it) => it.kind === "primary");
  const conflictIds = new Set<string>();
  for (let i = 0; i < primaries.length; i++) {
    for (let j = i + 1; j < primaries.length; j++) {
      const a = primaries[i]!;
      const c = primaries[j]!;
      if (a.startHour < c.endHour && c.startHour < a.endHour) {
        conflictIds.add(a.b.id);
        conflictIds.add(c.b.id);
      }
    }
  }

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
        className={`relative flex-1 transition-colors ${isOver ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""}`}
        style={{ height: laneCount * LANE_PX }}
      >
        {hours.map((h) => (
          <div
            key={h}
            aria-hidden
            className="absolute inset-y-0 w-px bg-border/40"
            style={{ left: `${pctOf(h, dayStart, dayHours)}%` }}
          />
        ))}
        {items.map((it) => {
          const lane = laneOf.get(it.key) ?? 0;
          const top = lane * LANE_PX + LANE_PAD;
          const height = LANE_PX - 2 * LANE_PAD;
          return it.kind === "primary" ? (
            <TimelineBlock
              key={it.key}
              b={it.b}
              noDriverLabel={noDriverLabel}
              dayStart={dayStart}
              dayHours={dayHours}
              top={top}
              height={height}
              conflict={conflictIds.has(it.b.id) && !isDuty}
            />
          ) : (
            <CoDriverGhost
              key={it.key}
              b={it.b}
              dayStart={dayStart}
              dayHours={dayHours}
              top={top}
              height={height}
              coDriverLabel={coDriverLabel}
            />
          );
        })}
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
  // Long-haul trips whose CO-DRIVER is this car's driver — painted as a ghost on
  // this row (their own car isn't dispatched; they ride in the primary's).
  const coDriverOn = (vehicleId: string) =>
    bookings.filter((b) => !!b.secondaryDriverName && b.secondaryVehicleId === vehicleId);
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

        {/* Job-type colour legend — each booking block is tinted by its type. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {JOB_LEGEND.map((jt) => (
            <span key={jt} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${JOB_COLOR[jt]!.dot}`} aria-hidden />
              {JOB_COLOR[jt]!.label}
            </span>
          ))}
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
                  coDriverBookings={coDriverOn(v.id)}
                  dutyLabel={t("duty")}
                  noDriverLabel={t("noDriver")}
                  coDriverLabel={t("coDriver")}
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
              <span className="font-medium">{activeBooking.timeLabel}–{activeBooking.endLabel}</span>
            </div>
            <div className="truncate text-muted-foreground">{activeBooking.purpose}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
