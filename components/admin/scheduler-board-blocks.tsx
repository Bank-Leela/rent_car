"use client";

import { Car, GripVertical, AlertTriangle, Link2, X } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AssignRecoButton } from "@/components/forms/assign-reco-button";
import {
  type SchedulerBooking,
  type SchedulerVehicle,
  jobStyle,
  pctOf,
  LANE_PX,
  LANE_PAD,
} from "@/components/admin/scheduler-board-shared";

// A timeline block: absolutely positioned by exact minute (startHour carries
// minutes/60), draggable via @dnd-kit. The source dims while a DragOverlay
// clone follows the cursor — smooth, no native-DnD jank.
function TimelineBlock({
  b,
  noDriverLabel,
  unassignLabel,
  onUnassign,
  dayStart,
  dayHours,
  top,
  height,
  conflict,
}: {
  b: SchedulerBooking;
  noDriverLabel: string;
  unassignLabel: string;
  // Move this trip back to the Unassigned queue (drag-free path).
  onUnassign: (bookingId: string) => void;
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
      className={`group absolute cursor-grab touch-none rounded-md border px-2 py-1 text-left text-[11px] shadow-sm transition-shadow hover:z-10 hover:shadow-md active:cursor-grabbing ${
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
      {/* Drag-free unassign: a hover ✕ sends the trip back to the queue. Stops
          pointer propagation so pressing it never starts a drag. */}
      <button
        type="button"
        title={unassignLabel}
        aria-label={unassignLabel}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onUnassign(b.id);
        }}
        className="absolute right-0.5 top-0.5 z-10 grid h-4 w-4 place-items-center rounded-sm bg-background/70 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
      <div className="flex items-center gap-1 whitespace-nowrap font-medium">
        <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        {/* bg-inherit lets a short block's time label spill past the bar's right
            edge and stay readable (carries the bar's own colour) instead of being
            clipped — a 2h block is too narrow to contain "13:00–15:00". */}
        <span className="rounded-r-sm bg-inherit pr-1">{b.timeLabel}–{b.endLabel}</span>
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
      className={`absolute rounded-md border border-dashed border-violet-400/70 bg-violet-50 px-2 py-1 text-left text-[11px] text-violet-900 hover:z-10 dark:bg-violet-950/30 dark:text-violet-200 ${
        b.continuesBefore ? "rounded-l-none border-l-4" : ""
      } ${b.continuesAfter ? "rounded-r-none border-r-4" : ""}`}
      style={{ left: `${left}%`, width: `${width}%`, top, height }}
    >
      <div className="flex items-center gap-1 whitespace-nowrap font-medium">
        <Link2 className="h-3 w-3 shrink-0" aria-hidden />
        <span className="rounded-r-sm bg-inherit pr-1">{b.timeLabel}–{b.endLabel}</span>
      </div>
      <div className="truncate text-[10px] font-medium">{coDriverLabel}</div>
      {b.driverName && (
        <div className="truncate text-[10px] text-violet-700 dark:text-violet-300">→ {b.driverName}</div>
      )}
    </div>
  );
}

// An unassigned-queue card (booking with no vehicle yet).
export function QueueCard({ b }: { b: SchedulerBooking }) {
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
export function CarRow({
  vehicle,
  label,
  isDuty,
  bookings,
  coDriverBookings,
  dutyLabel,
  noDriverLabel,
  coDriverLabel,
  unassignLabel,
  onUnassign,
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
  unassignLabel: string;
  onUnassign: (bookingId: string) => void;
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

  // Flag PRIMARY trips that overlap another primary on this car — on EVERY car,
  // duty included (no car may be double-booked). Co-driver ghosts are ride-alongs
  // and never count as conflicts.
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
              unassignLabel={unassignLabel}
              onUnassign={onUnassign}
              dayStart={dayStart}
              dayHours={dayHours}
              top={top}
              height={height}
              conflict={conflictIds.has(it.b.id)}
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
