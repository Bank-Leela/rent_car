"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Car, GripVertical, Link2, Lock, Send, Undo2, X } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  rectIntersection,
  MeasuringStrategy,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  type SchedulerVehicle,
  type SchedulerBooking,
  jobStyle,
  carLabel,
  pctOf,
  DEFAULT_START,
  DEFAULT_END,
  LANE_PX,
  LANE_PAD,
} from "@/components/admin/scheduler-board-shared";
import {
  draftReassignAction,
  submitDraftAction,
  resetDraftAction,
  withdrawDraftAction,
} from "@/lib/booking/draft-actions";

const QUEUE_ID = "__draft_queue__";

type Labels = {
  duty: string; noDriver: string; coDriver: string; arrives: string; empty: string;
  queue: string; queueEmpty: string; moved: string;
  submit: string; submitted: string; reset: string; withdraw: string;
  hint: string; lockedHint: string; error: string;
};

export function DriverDraftBoard({
  vehicles,
  bookings,
  queue,
  movedIds,
  hasUnsubmittedDraft,
  submittedDraft,
  labels,
}: {
  vehicles: SchedulerVehicle[];
  bookings: SchedulerBooking[];
  queue: SchedulerBooking[];
  movedIds: string[];
  hasUnsubmittedDraft: boolean;
  submittedDraft: boolean;
  labels: Labels;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const moved = new Set(movedIds);
  // Once submitted, the day's board is read-only until P'Top applies/dismisses or
  // the driver explicitly Withdraws — a drag must never silently retract a move.
  const locked = submittedDraft;

  const all = [...bookings, ...queue];
  const dayBookingIds = all.map((b) => b.id);
  const realEnds = all.filter((b) => b.endHour < 24).map((b) => b.endHour);
  const dayStart = Math.max(0, Math.floor(Math.min(DEFAULT_START, ...all.map((b) => b.startHour))));
  const dayEnd = Math.min(24, Math.ceil(Math.max(DEFAULT_END, ...realEnds)));
  const dayHours = dayEnd - dayStart;
  const hours = Array.from({ length: dayHours + 1 }, (_, i) => dayStart + i);
  const { setNodeRef: queueRef, isOver: queueIsOver } = useDroppable({ id: QUEUE_ID, disabled: locked });
  const onVehicle = (vid: string) => bookings.filter((b) => b.vehicleId === vid);
  // Co-driver ghosts: a trip's secondary driver shown on THEIR own car's row —
  // read-only, identical to the official board, so the two views match.
  const coDriverOn = (vid: string) =>
    all.filter((b) => !!b.secondaryDriverName && b.secondaryVehicleId === vid);
  const activeBooking = activeId ? all.find((b) => b.id === activeId) ?? null : null;

  function draftMove(bookingId: string, vehicleId: string | null) {
    if (locked) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("bookingId", bookingId);
      if (vehicleId) fd.append("vehicleId", vehicleId);
      const res = await draftReassignAction(fd);
      if (!res.ok) setError(labels.error);
      router.refresh();
    });
  }
  function submit() {
    setError(null);
    startTransition(async () => {
      await submitDraftAction(dayBookingIds);
      router.refresh();
    });
  }
  function reset() {
    setError(null);
    startTransition(async () => {
      await resetDraftAction(dayBookingIds);
      router.refresh();
    });
  }
  function withdraw() {
    setError(null);
    startTransition(async () => {
      await withdrawDraftAction(dayBookingIds);
      router.refresh();
    });
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (locked) return;
    const overId = e.over != null ? String(e.over.id) : null;
    const bookingId = String(e.active.id);
    if (overId && vehicles.some((v) => v.id === overId)) draftMove(bookingId, overId);
    else if (overId === QUEUE_ID) draftMove(bookingId, null);
  }

  return (
    <DndContext
      id="driver-draft-board"
      sensors={sensors}
      collisionDetection={rectIntersection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={onDragEnd}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {locked && <Lock className="h-3.5 w-3.5" aria-hidden />}
            {locked ? labels.lockedHint : labels.hint}
          </p>
          <div className="flex items-center gap-2">
            {locked ? (
              <>
                <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                  {labels.submitted}
                </span>
                <button
                  type="button"
                  onClick={withdraw}
                  disabled={pending}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <X className="h-4 w-4" aria-hidden /> {labels.withdraw}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={reset}
                  disabled={pending || !hasUnsubmittedDraft}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <Undo2 className="h-4 w-4" aria-hidden /> {labels.reset}
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending || !hasUnsubmittedDraft}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <Send className="h-4 w-4" aria-hidden /> {labels.submit}
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <div
          ref={queueRef}
          className={`rounded-xl border bg-muted/30 p-3 transition-colors ${queueIsOver ? "ring-2 ring-inset ring-primary/50 bg-primary/5" : ""}`}
        >
          <h2 className="mb-2 text-sm font-semibold">
            {labels.queue} <span className="text-muted-foreground">({queue.length})</span>
          </h2>
          {queue.length === 0 ? (
            <p className="text-xs text-muted-foreground">{labels.queueEmpty}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {queue.map((b) => (
                <QueueCard key={b.id} b={b} moved={moved.has(b.id)} movedLabel={labels.moved} locked={locked} />
              ))}
            </div>
          )}
        </div>

        {vehicles.length === 0 ? (
          <p className="text-sm text-muted-foreground">{labels.empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <div className="min-w-[64rem]">
              <div className="flex border-b bg-muted/30">
                <div className="w-44 shrink-0 border-r" />
                <div className="relative h-8 flex-1">
                  {hours.map((h) => (
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
                <Row
                  key={v.id}
                  vehicle={v}
                  label={carLabel(i)}
                  bookings={onVehicle(v.id)}
                  coDrivers={coDriverOn(v.id)}
                  moved={moved}
                  locked={locked}
                  dayStart={dayStart}
                  dayHours={dayHours}
                  hours={hours}
                  labels={labels}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeBooking ? (
          <div className="pointer-events-none w-56 cursor-grabbing rounded-md border bg-card p-2 text-xs shadow-lg ring-2 ring-primary/50">
            <span className="font-mono text-[10px] text-muted-foreground">{activeBooking.jobNumber}</span>{" "}
            <span className="font-medium">{activeBooking.timeLabel}–{activeBooking.endLabel}</span>
            <div className="truncate text-muted-foreground">{activeBooking.purpose}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function QueueCard({ b, moved, movedLabel, locked }: { b: SchedulerBooking; moved: boolean; movedLabel: string; locked: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: b.id, disabled: locked });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`w-56 touch-none rounded-md border p-2 text-left text-xs shadow-sm ${locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"} ${jobStyle(b.jobType).block} ${moved ? "ring-2 ring-amber-400" : ""}`}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-center gap-1">
        {!locked && <GripVertical className="h-3 w-3 text-muted-foreground" aria-hidden />}
        <span className="font-mono text-[10px] text-muted-foreground">{b.jobNumber}</span>
        <span className="font-medium">{b.timeLabel}–{b.endLabel}</span>
        {moved && <span className="ml-auto rounded bg-amber-100 px-1 text-[9px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{movedLabel}</span>}
      </div>
      <div className="truncate text-muted-foreground">{b.purpose}</div>
    </div>
  );
}

function Row({
  vehicle, label, bookings, coDrivers, moved, locked, dayStart, dayHours, hours, labels,
}: {
  vehicle: SchedulerVehicle;
  label: string;
  bookings: SchedulerBooking[];
  coDrivers: SchedulerBooking[];
  moved: Set<string>;
  locked: boolean;
  dayStart: number;
  dayHours: number;
  hours: number[];
  labels: Labels;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: vehicle.id, disabled: locked });
  // Primary (draggable) trips + co-driver (read-only) ghosts share the lanes, so
  // the layout matches the official read-only board exactly.
  type Item = { key: string; b: SchedulerBooking; kind: "primary" | "co" };
  const items: Item[] = [
    ...bookings.map((b) => ({ key: b.id, b, kind: "primary" as const })),
    ...coDrivers.map((b) => ({ key: `co-${b.id}`, b, kind: "co" as const })),
  ];
  const sorted = [...items].sort((a, b) => a.b.startHour - b.b.startHour || a.b.endHour - b.b.endHour);
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const it of sorted) {
    let lane = laneEnds.findIndex((end) => end <= it.b.startHour);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.b.endHour); }
    else laneEnds[lane] = it.b.endHour;
    laneOf.set(it.key, lane);
  }
  const laneCount = Math.max(1, laneEnds.length);
  return (
    <div className="flex border-b last:border-b-0">
      <div className="flex w-44 shrink-0 items-center gap-2 border-r px-3 py-2 text-sm font-medium">
        <Car className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0">{label}</span>
        {vehicle.driverName ? (
          <span className="truncate text-xs font-normal text-muted-foreground">· {vehicle.driverName}</span>
        ) : (
          <span className="truncate text-[10px] font-normal text-destructive">· {labels.noDriver}</span>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`relative flex-1 transition-colors ${isOver ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""}`}
        style={{ height: laneCount * LANE_PX }}
      >
        {hours.map((h) => (
          <div key={h} aria-hidden className="absolute inset-y-0 w-px bg-border/40" style={{ left: `${pctOf(h, dayStart, dayHours)}%` }} />
        ))}
        {sorted.map((it) => {
          const top = (laneOf.get(it.key) ?? 0) * LANE_PX + LANE_PAD;
          const height = LANE_PX - 2 * LANE_PAD;
          return it.kind === "co" ? (
            <CoGhost key={it.key} b={it.b} label={labels.coDriver} arrives={labels.arrives} dayStart={dayStart} dayHours={dayHours} top={top} height={height} />
          ) : (
            <DraftBlock
              key={it.key}
              b={it.b}
              moved={moved.has(it.b.id)}
              movedLabel={labels.moved}
              arrives={labels.arrives}
              locked={locked}
              dayStart={dayStart}
              dayHours={dayHours}
              top={top}
              height={height}
            />
          );
        })}
      </div>
    </div>
  );
}

// Read-only co-driver ghost — the secondary driver shown on their own car's row.
// Visually identical to the official board's ghost; never draggable (the driver
// draft only re-homes the PRIMARY car).
function CoGhost({
  b, label, arrives, dayStart, dayHours, top, height,
}: {
  b: SchedulerBooking;
  label: string;
  arrives: string;
  dayStart: number;
  dayHours: number;
  top: number;
  height: number;
}) {
  const left = pctOf(b.startHour, dayStart, dayHours);
  const width = Math.max(pctOf(b.endHour, dayStart, dayHours) - left, 1.2);
  const multiDay = b.continuesBefore || b.continuesAfter;
  return (
    <div
      title={`${b.jobNumber} · ${b.timeLabel} · ${b.purpose}`}
      className={`absolute overflow-hidden rounded-md border border-dashed border-violet-400/70 bg-violet-50 px-2 py-1 text-left text-[11px] text-violet-900 dark:bg-violet-950/30 dark:text-violet-200 ${b.continuesBefore ? "rounded-l-none border-l-4" : ""} ${b.continuesAfter ? "rounded-r-none border-r-4" : ""}`}
      style={{ left: `${left}%`, width: `${width}%`, top, height }}
    >
      <div className="flex items-center gap-1 font-medium">
        <Link2 className="h-3 w-3 shrink-0" aria-hidden />
        {multiDay ? (
          <>
            <span className="min-w-0 truncate">{b.departLabel}</span>
            <span className="ml-auto shrink-0 truncate pl-1">{arrives} {b.arriveLabel}</span>
          </>
        ) : (
          <span className="min-w-0 truncate">{b.timeLabel}–{b.endLabel}</span>
        )}
      </div>
      <div className="truncate text-[10px] font-medium">{label}</div>
      {b.driverName && <div className="truncate text-[10px] text-violet-700 dark:text-violet-300">→ {b.driverName}</div>}
    </div>
  );
}

function DraftBlock({
  b, moved, movedLabel, arrives, locked, dayStart, dayHours, top, height,
}: {
  b: SchedulerBooking;
  moved: boolean;
  movedLabel: string;
  arrives: string;
  locked: boolean;
  dayStart: number;
  dayHours: number;
  top: number;
  height: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: b.id, disabled: locked });
  const left = pctOf(b.startHour, dayStart, dayHours);
  const width = Math.max(pctOf(b.endHour, dayStart, dayHours) - left, 1.2);
  const multiDay = b.continuesBefore || b.continuesAfter;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`${b.jobNumber} · ${b.timeLabel} · ${b.purpose}`}
      className={`absolute touch-none overflow-hidden rounded-md border px-2 py-1 text-left text-[11px] shadow-sm ${locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"} ${jobStyle(b.jobType).block} ${b.secondaryDriverName ? "ring-1 ring-violet-400/70" : ""} ${moved ? "ring-2 ring-amber-400" : ""} ${b.continuesBefore ? "rounded-l-none border-l-4" : ""} ${b.continuesAfter ? "rounded-r-none border-r-4" : ""}`}
      style={{ left: `${left}%`, width: `${width}%`, top, height, opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-center gap-1 font-medium">
        {!locked && <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
        {multiDay ? (
          <>
            <span className="min-w-0 truncate">{b.departLabel}</span>
            <span className="ml-auto shrink-0 truncate pl-1">{arrives} {b.arriveLabel}</span>
          </>
        ) : (
          <span className="min-w-0 truncate">{b.timeLabel}–{b.endLabel}</span>
        )}
        {moved && <span className="ml-auto shrink-0 rounded bg-amber-100 px-1 text-[9px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{movedLabel}</span>}
      </div>
      <div className="truncate text-muted-foreground">{b.purpose}</div>
    </div>
  );
}
