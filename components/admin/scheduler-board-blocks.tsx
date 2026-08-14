"use client";

import { GripVertical, AlertTriangle, Link2, X, Truck, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AssignRecoButton } from "@/components/forms/assign-reco-button";

import { formatBaht } from "@/lib/format-money";
import {
  type SchedulerBooking,
  type SchedulerVehicle,
  jobStyle,
  pctOf,
  LANE_PX,
  WORK_START_HOUR,
  WORK_END_HOUR,
  LANE_PAD,
} from "@/components/admin/scheduler-board-shared";

// A timeline block: absolutely positioned by exact minute (startHour carries
// minutes/60), draggable via @dnd-kit. The source dims while a DragOverlay
// clone follows the cursor — smooth, no native-DnD jank.
function TimelineBlock({
  b,
  noDriverLabel,
  arrivesLabel,
  unassignLabel,
  onUnassign,
  dayStart,
  dayHours,
  top,
  height,
}: {
  b: SchedulerBooking;
  noDriverLabel: string;
  // Prefix for the pinned arrival on a multi-day block (e.g. "ถึง" / "arr.").
  arrivesLabel: string;
  unassignLabel: string;
  // Move this trip back to the Unassigned queue (drag-free path).
  onUnassign: (bookingId: string) => void;
  dayStart: number;
  dayHours: number;
  // Vertical placement within the car row: which stacked lane this block sits in.
  top: number;
  height: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: b.id });
  const tc = useTranslations("common");
  const left = pctOf(b.startHour, dayStart, dayHours);
  // True size: a short trip stays a small sliver (5 min ≈ 0.6% of the track);
  // 1.2% floor keeps a tiny job hoverable.
  const width = Math.max(pctOf(b.endHour, dayStart, dayHours) - left, 1.2);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`${b.timeLabel} · ${b.purpose} → ${b.destination}`}
      className={`group absolute cursor-grab touch-none overflow-hidden rounded-md border px-2 py-1 text-left text-[11px] shadow-sm transition-shadow hover:z-10 hover:shadow-md active:cursor-grabbing ${
        jobStyle(b.jobType).block
      } ${
        b.secondaryDriverName
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
      <div className="flex items-center gap-1 font-medium">
        <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        {b.continuesBefore || b.continuesAfter ? (
          // Multi-day: depart pinned to the left, arrive pinned to the right, so the
          // whole span (which day → which day, depart + arrive time) shows on every
          // day the trip appears. pr-4 keeps the arrival clear of the hover ✕.
          <>
            <span className="min-w-0 truncate">{b.departLabel}</span>
            <span className="ml-auto shrink-0 truncate pr-4">{arrivesLabel} {b.arriveLabel}</span>
          </>
        ) : (
          // Same-day: compact start–end (e.g. "08–12"); full time in the tooltip.
          <span className="min-w-0 truncate">{b.timeLabel}–{b.endLabel}</span>
        )}
      </div>
      <div className="truncate text-muted-foreground">{b.purpose}</div>
      {(b.travelWithinChula === false || b.googleMapsUrl) && (
        <div className="mt-0.5 flex items-center gap-1">
          {b.travelWithinChula === false && (
            <span className="rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
              {tc("outsideChula")}
            </span>
          )}
          {b.googleMapsUrl && (
            <a
              href={b.googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="text-primary hover:text-primary/80"
              aria-label="Google Maps"
            >
              <MapPin className="h-3 w-3" aria-hidden />
            </a>
          )}
        </div>
      )}
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
  arrivesLabel,
}: {
  b: SchedulerBooking;
  dayStart: number;
  dayHours: number;
  top: number;
  height: number;
  coDriverLabel: string;
  arrivesLabel: string;
}) {
  // Draggable: the ghost id is namespaced `co:<bookingId>` so the board's drag
  // handler can tell a co-driver move from a primary-block reassign. Dropping it
  // on another car row reassigns the co-driver; off any row removes them.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `co:${b.id}` });
  const left = pctOf(b.startHour, dayStart, dayHours);
  const width = Math.max(pctOf(b.endHour, dayStart, dayHours) - left, 1.2);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`${b.timeLabel} · ${coDriverLabel}${b.driverName ? " → " + b.driverName : ""} · ${b.purpose}`}
      className={`absolute cursor-grab touch-none overflow-hidden rounded-md border border-dashed border-violet-400/70 bg-violet-50 px-2 py-1 text-left text-[11px] text-violet-900 hover:z-10 active:cursor-grabbing dark:bg-violet-950/30 dark:text-violet-200 ${
        b.continuesBefore ? "rounded-l-none border-l-4" : ""
      } ${b.continuesAfter ? "rounded-r-none border-r-4" : ""}`}
      style={{ left: `${left}%`, width: `${width}%`, top, height, opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-center gap-1 font-medium">
        <Link2 className="h-3 w-3 shrink-0" aria-hidden />
        {b.continuesBefore || b.continuesAfter ? (
          <>
            <span className="min-w-0 truncate">{b.departLabel}</span>
            <span className="ml-auto shrink-0 truncate pl-1">{arrivesLabel} {b.arriveLabel}</span>
          </>
        ) : (
          <span className="min-w-0 truncate">{b.timeLabel}–{b.endLabel}</span>
        )}
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
  const tc = useTranslations("common");
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`${b.timeLabel} · ${b.purpose}`}
      className={`w-56 cursor-grab touch-none rounded-md border p-2 text-left text-xs shadow-sm active:cursor-grabbing ${jobStyle(b.jobType).block}`}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-center gap-1">
        <GripVertical className="h-3 w-3 text-muted-foreground" aria-hidden />
        <span className={`h-2 w-2 shrink-0 rounded-full ${jobStyle(b.jobType).dot}`} aria-hidden />
        <span className="font-medium">{b.timeLabel}–{b.endLabel}</span>
      </div>
      <div className="truncate text-muted-foreground">
        {b.purpose} → {b.destination}
      </div>
      {(b.travelWithinChula === false || b.googleMapsUrl) && (
        <div className="mt-0.5 flex items-center gap-1">
          {b.travelWithinChula === false && (
            <span className="rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
              {tc("outsideChula")}
            </span>
          )}
          {b.googleMapsUrl && (
            <a
              href={b.googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="text-primary hover:text-primary/80"
              aria-label="Google Maps"
            >
              <MapPin className="h-3 w-3" aria-hidden />
            </a>
          )}
        </div>
      )}
      {b.reco && (
        // One-click assign to the recommendation. Stop pointer propagation so
        // tapping the button doesn't start a drag.
        //
        // The recommended car and driver are NOT printed on the card: this trip
        // has no car yet, and a plate plus a driver's name sitting on it read as
        // though one had already been assigned. The suggestion stays on the
        // button's tooltip — same treatment the job number got.
        <div
          className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]"
          onPointerDown={(e) => e.stopPropagation()}
          title={b.reco.label}
        >
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

// A "parked" co-driver slot: a long-haul trip with a car + primary but no
// co-driver. Dragged with the `co:` id so dropping it on a car fills the slot
// (reassignSecondary). This is where a co-driver lands after being dragged off
// a row — it parks here instead of vanishing.
export function CoDriverQueueCard({ b, label }: { b: SchedulerBooking; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `co:${b.id}` });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`${b.timeLabel} · ${b.purpose} · ${label}${b.driverName ? " → " + b.driverName : ""}`}
      className="w-56 cursor-grab touch-none rounded-md border border-dashed border-violet-400/70 bg-violet-50 p-2 text-left text-xs shadow-sm active:cursor-grabbing dark:bg-violet-950/30 dark:text-violet-200"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-center gap-1 font-medium text-violet-800 dark:text-violet-200">
        <Link2 className="h-3 w-3 shrink-0" aria-hidden />
        <span>
          {b.timeLabel}–{b.endLabel}
        </span>
      </div>
      <div className="truncate text-violet-700 dark:text-violet-300">{label}</div>
      {b.driverName && (
        <div className="truncate text-[10px] text-violet-700/80 dark:text-violet-300/80">→ {b.driverName}</div>
      )}
    </div>
  );
}

// Read-only "return pickup" leg (leg 2) of a no-wait trip. The draggable primary
// block is leg 1; this ghost shows the car going out again to collect passengers,
// with the freed middle between them. Styled in the trip's job colour, dashed.
function ReturnLegGhost({
  b,
  returnLegLabel,
  dayStart,
  dayHours,
  top,
  height,
}: {
  b: SchedulerBooking;
  returnLegLabel: string;
  dayStart: number;
  dayHours: number;
  top: number;
  height: number;
}) {
  const leg = b.returnLeg!;
  const left = pctOf(leg.startHour, dayStart, dayHours);
  const width = Math.max(pctOf(leg.endHour, dayStart, dayHours) - left, 1.2);
  return (
    <div
      title={`${b.destination} · ${returnLegLabel} · ${leg.timeLabel}–${leg.endLabel}`}
      className={`absolute overflow-hidden rounded-md border border-dashed px-2 py-1 text-left text-[11px] opacity-80 ${jobStyle(b.jobType).block}`}
      style={{ left: `${left}%`, width: `${width}%`, top, height }}
    >
      <div className="truncate font-medium">
        {leg.timeLabel}–{leg.endLabel}
      </div>
      <div className="truncate text-[10px] text-muted-foreground">{returnLegLabel}</div>
    </div>
  );
}

// A car row = a droppable lane. Drop a card here to assign this car + a driver.
export function CarRow({
  vehicle,
  label,
  isDuty,
  offLabel,
  bookings,
  coDriverBookings,
  dutyLabel,
  noDriverLabel,
  coDriverLabel,
  arrivesLabel,
  returnLegLabel,
  unassignLabel,
  onUnassign,
  dayStart,
  dayHours,
  hours,
}: {
  vehicle: SchedulerVehicle;
  label: string;
  isDuty: boolean;
  /** Thai for "ลา" — shown instead of the เวร badge when the driver is away. */
  offLabel: string;
  bookings: SchedulerBooking[];
  // Long-haul trips where THIS car's driver rides as co-driver (painted as ghosts).
  coDriverBookings: SchedulerBooking[];
  dutyLabel: string;
  noDriverLabel: string;
  coDriverLabel: string;
  arrivesLabel: string;
  returnLegLabel: string;
  unassignLabel: string;
  onUnassign: (bookingId: string) => void;
  dayStart: number;
  dayHours: number;
  hours: number[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: vehicle.id });
  // Read here rather than taken as a prop: every other label on this row is
  // passed down from the board, but the board is LOCKED to another session right
  // now and a new required prop would force an edit to it. This component is
  // already a client component with next-intl available, so it can ask directly.
  const freeLabel = useTranslations("scheduler")("roundsFree");

  // Row items = the car's own trips (draggable) + co-driver ghosts (read-only).
  // Both occupy time, so both feed the lane packing.
  type RowItem = {
    key: string;
    b: SchedulerBooking;
    kind: "primary" | "co" | "return";
    startHour: number;
    endHour: number;
  };
  const items: RowItem[] = [
    ...bookings.map((b) => ({ key: b.id, b, kind: "primary" as const, startHour: b.startHour, endHour: b.endHour })),
    ...coDriverBookings.map((b) => ({ key: `co-${b.id}`, b, kind: "co" as const, startHour: b.startHour, endHour: b.endHour })),
    // No-wait return legs: read-only ghosts; occupy the lane so nothing stacks on them.
    ...bookings
      .filter((b) => b.returnLeg)
      .map((b) => ({
        key: `ret-${b.id}`,
        b,
        kind: "return" as const,
        startHour: b.returnLeg!.startHour,
        endHour: b.returnLeg!.endHour,
      })),
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

  // A driver on leave takes their car with them (car = driver), so the row is
  // marked the same way the rounds board marks it: amber edge stripe, struck-out
  // name, ลา badge. Anything already sitting on the row is what has to be moved.
  const off = vehicle.isOff === true;
  return (
    // The เวร row is tinted here exactly as it is on the rounds whiteboard — same
    // emerald edge stripe, same wash. The two boards showed the same fact in two
    // different ways (badge only here, whole row there), so "who is on duty"
    // needed re-learning when you switched surfaces. `off` still wins: a driver
    // on leave is not running campus duty.
    <div
      className={`flex border-b last:border-b-0 ${
        off
          ? "border-l-4 border-l-amber-400 bg-amber-50/40 dark:bg-amber-950/20"
          : isDuty
            ? "border-l-4 border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
            : ""
      }`}
    >
      <div
        className="flex w-44 shrink-0 items-center gap-2 border-r px-3 py-2 text-sm font-medium"
        title={vehicle.registrationNumber}
      >
        {/* The car letter as a plate rather than a bare character. Six rows of
            "A · name" with nothing else on them read as a list of labels; the
            plate gives each row an anchor, and the registration underneath is
            the thing anyone actually radios about. Both were already loaded —
            registrationNumber sat in `vehicle` and was used only as a tooltip. */}
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-semibold ${
            off
              ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
              : isDuty
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {label}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          {vehicle.driverName ? (
            <span className={`truncate text-xs ${off ? "text-muted-foreground line-through" : ""}`}>
              {vehicle.driverName}
            </span>
          ) : (
            <span className="truncate text-[10px] font-normal text-destructive">{noDriverLabel}</span>
          )}
          <span className="flex items-center gap-1.5 truncate text-[10px] font-normal text-muted-foreground">
            <span className="tabular-nums">{vehicle.registrationNumber}</span>
            {/* How loaded this driver is, at a glance. An empty row used to be
                indistinguishable from a broken one; "ว่าง" says it is free on
                purpose. Reuses scheduler.roundsFree — no new copy. */}
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {bookings.length > 0 ? bookings.length : freeLabel}
            </span>
          </span>
        </span>
        {off ? (
          <span className="ml-auto shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            {offLabel}
          </span>
        ) : (
          isDuty && (
            // Emerald, matching the row stripe. It was amber — the same chip the
            // ลา badge uses — so after the row tinting went in, "on duty" and
            // "on leave" were the same colour on differently-coloured rows.
            <span className="ml-auto shrink-0 rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
              {dutyLabel}
            </span>
          )
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`relative flex-1 transition-colors ${isOver ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""}`}
        style={{ height: laneCount * LANE_PX }}
      >
        {/* Off-hours shading. Every hour column used to look identical, so the
            eye had nothing to anchor on and an empty row was just a wide grey
            band. Dimming the hours outside 08:00–16:00 makes the work day the
            lit part of the row — the block positions then read as "early",
            "mid-morning", "late" at a glance instead of needing the header.
            Two panels rather than one striped background so the boundaries land
            exactly on the axis scale the blocks use. */}
        {dayStart < WORK_START_HOUR && (
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 bg-foreground/[0.035] dark:bg-black/25"
            style={{ width: `${pctOf(WORK_START_HOUR, dayStart, dayHours)}%` }}
          />
        )}
        {dayStart + dayHours > WORK_END_HOUR && (
          <div
            aria-hidden
            className="absolute inset-y-0 right-0 bg-foreground/[0.035] dark:bg-black/25"
            style={{ left: `${pctOf(WORK_END_HOUR, dayStart, dayHours)}%` }}
          />
        )}
        {hours.map((h) => (
          <div
            key={h}
            aria-hidden
            // The work-day boundaries get a real line; the rest stay hairlines.
            className={`absolute inset-y-0 w-px ${
              h === WORK_START_HOUR || h === WORK_END_HOUR ? "bg-border" : "bg-border/40"
            }`}
            style={{ left: `${pctOf(h, dayStart, dayHours)}%` }}
          />
        ))}
        {items.map((it) => {
          const lane = laneOf.get(it.key) ?? 0;
          const top = lane * LANE_PX + LANE_PAD;
          const height = LANE_PX - 2 * LANE_PAD;
          if (it.kind === "primary") {
            return (
              <TimelineBlock
                key={it.key}
                b={it.b}
                noDriverLabel={noDriverLabel}
                arrivesLabel={arrivesLabel}
                unassignLabel={unassignLabel}
                onUnassign={onUnassign}
                dayStart={dayStart}
                dayHours={dayHours}
                top={top}
                height={height}
              />
            );
          }
          if (it.kind === "return") {
            return (
              <ReturnLegGhost
                key={it.key}
                b={it.b}
                returnLegLabel={returnLegLabel}
                dayStart={dayStart}
                dayHours={dayHours}
                top={top}
                height={height}
              />
            );
          }
          return (
            <CoDriverGhost
              key={it.key}
              b={it.b}
              dayStart={dayStart}
              dayHours={dayHours}
              top={top}
              height={height}
              coDriverLabel={coDriverLabel}
              arrivesLabel={arrivesLabel}
            />
          );
        })}
      </div>
    </div>
  );
}

// A per-day external/outside-driver row. Its trips are OUTSOURCED (off-algorithm)
// and rendered in a neutral zinc tint so they read as "not our fleet". Drop a
// queue card / scheduled block here to outsource it; drag a block off to return.
export type AdHocRowData = {
  id: string;
  label: string;
  cost: string | null;
  bookings: SchedulerBooking[];
};

function ExtBlock({
  b,
  dayStart,
  dayHours,
  top,
  height,
}: {
  b: SchedulerBooking;
  dayStart: number;
  dayHours: number;
  top: number;
  height: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `ext:${b.id}` });
  const left = pctOf(b.startHour, dayStart, dayHours);
  const width = Math.max(pctOf(b.endHour, dayStart, dayHours) - left, 1.2);
  const multiDay = b.continuesBefore || b.continuesAfter;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`${b.timeLabel} · ${b.purpose} → ${b.destination}`}
      className={`absolute cursor-grab touch-none overflow-hidden rounded-md border border-dashed border-zinc-400 bg-zinc-100 px-2 py-1 text-left text-[11px] text-zinc-800 active:cursor-grabbing dark:border-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-200 ${
        b.continuesBefore ? "rounded-l-none border-l-4" : ""
      } ${b.continuesAfter ? "rounded-r-none border-r-4" : ""}`}
      style={{ left: `${left}%`, width: `${width}%`, top, height, opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-center gap-1 font-medium">
        {multiDay ? (
          <>
            <span className="min-w-0 truncate">{b.departLabel}</span>
            <span className="ml-auto shrink-0 truncate pl-1">{b.arriveLabel}</span>
          </>
        ) : (
          <span className="min-w-0 truncate">
            {b.timeLabel}–{b.endLabel}
          </span>
        )}
      </div>
      <div className="truncate text-zinc-600 dark:text-zinc-400">{b.purpose}</div>
    </div>
  );
}

export function AdHocRow({
  row,
  dayStart,
  dayHours,
  hours,
  removeLabel,
  onRemove,
}: {
  row: AdHocRowData;
  dayStart: number;
  dayHours: number;
  hours: number[];
  removeLabel: string;
  onRemove: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `adhoc:${row.id}` });
  const sorted = [...row.bookings].sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const b of sorted) {
    let lane = laneEnds.findIndex((end) => end <= b.startHour);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(b.endHour);
    } else laneEnds[lane] = b.endHour;
    laneOf.set(b.id, lane);
  }
  const laneCount = Math.max(1, laneEnds.length);

  return (
    <div className="flex border-b last:border-b-0">
      <div className="flex w-44 shrink-0 items-center gap-2 border-r px-3 py-2 text-sm font-medium">
        <Truck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate" title={row.label}>
          {row.label}
        </span>
        {row.cost && <span className="shrink-0 text-[10px] text-muted-foreground">{formatBaht(row.cost)}</span>}
        <button
          type="button"
          title={removeLabel}
          aria-label={removeLabel}
          onClick={() => onRemove(row.id)}
          className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div
        ref={setNodeRef}
        className={`relative flex-1 transition-colors ${isOver ? "bg-zinc-200/60 ring-1 ring-inset ring-zinc-400 dark:bg-zinc-700/40" : ""}`}
        style={{ height: laneCount * LANE_PX }}
      >
        {/* Same off-hours shading as the car rows — a hired vehicle's row sat
            on a flat track while the fleet rows above it were graded, so the
            two halves of one board disagreed about what a work day looks like. */}
        {dayStart < WORK_START_HOUR && (
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 bg-foreground/[0.035] dark:bg-black/25"
            style={{ width: `${pctOf(WORK_START_HOUR, dayStart, dayHours)}%` }}
          />
        )}
        {dayStart + dayHours > WORK_END_HOUR && (
          <div
            aria-hidden
            className="absolute inset-y-0 right-0 bg-foreground/[0.035] dark:bg-black/25"
            style={{ left: `${pctOf(WORK_END_HOUR, dayStart, dayHours)}%` }}
          />
        )}
        {hours.map((h) => (
          <div
            key={h}
            aria-hidden
            className={`absolute inset-y-0 w-px ${
              h === WORK_START_HOUR || h === WORK_END_HOUR ? "bg-border" : "bg-border/40"
            }`}
            style={{ left: `${pctOf(h, dayStart, dayHours)}%` }}
          />
        ))}
        {sorted.map((b) => {
          const top = (laneOf.get(b.id) ?? 0) * LANE_PX + LANE_PAD;
          return (
            <ExtBlock key={b.id} b={b} dayStart={dayStart} dayHours={dayHours} top={top} height={LANE_PX - 2 * LANE_PAD} />
          );
        })}
      </div>
    </div>
  );
}
