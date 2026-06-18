"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { format } from "date-fns";
import { th, enUS } from "date-fns/locale";
import { Wand2, GripVertical, AlertTriangle } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  rectIntersection,
  MeasuringStrategy,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { matchBookingAction } from "@/lib/booking/matching-actions";
import {
  reassignVehicleAction,
  unassignBookingAction,
  resolveScheduleConflictsAction,
  type ReassignConflict,
} from "@/lib/booking/schedule-actions";
import {
  type SchedulerVehicle,
  type SchedulerBooking,
  JOB_COLOR,
  JOB_LEGEND,
  carLabel,
  pctOf,
  DEFAULT_START,
  DEFAULT_END,
} from "@/components/admin/scheduler-board-shared";
import { QueueCard, CarRow } from "@/components/admin/scheduler-board-blocks";

// Public types — re-exported so existing importers (the schedule page) keep
// working after the block/theme extraction.
export type { SchedulerVehicle, SchedulerBooking } from "@/components/admin/scheduler-board-shared";

// Droppable id for the unassigned-queue zone. Distinct from any vehicleId so the
// drop handler can tell "back to queue" from "onto a car".
const QUEUE_DROP_ID = "__queue__";


export function SchedulerBoard({
  vehicles,
  bookings,
  dutyVehicleId,
  conflictCount,
  date,
}: {
  vehicles: SchedulerVehicle[];
  bookings: SchedulerBooking[];
  dutyVehicleId: string | null;
  // Overlap conflicts among assigned trips that auto-assign will try to resolve.
  conflictCount: number;
  // ISO yyyy-MM-dd of the viewed day — passed to the conflict-resolve action.
  date: string;
}) {
  const t = useTranslations("scheduler");
  const locale = useLocale();
  const dfLocale = locale.toLowerCase().startsWith("th") ? th : enUS;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ assigned: number; failures: string[] } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // 4px travel before a drag starts → a plain click still shows the title tooltip.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // The unassigned queue is itself a drop target: drag an assigned block up here
  // to send the trip back to the queue (clears its car + driver).
  const queueDrop = useDroppable({ id: QUEUE_DROP_ID });

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

  // "VB-202606-9 · 18 Jun 09:00–11:00" — names a blocking trip with its DAY, so a
  // multi-day clash on a day that isn't on screen is visible in the reject banner.
  const fmtConflict = (c: ReassignConflict) =>
    `${c.jobNumber} · ${format(c.startAt, "d MMM", { locale: dfLocale })} ${format(c.startAt, "HH:mm")}–${format(c.endAt, "HH:mm")}`;

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
        // vehicleBusy carries the conflicting trip(s) → name them (incl. the day)
        // so a multi-day overlap on an off-screen day isn't a mystery.
        if (res.error === "vehicleBusy" && res.conflicts?.length) {
          setDropError(t("dropConflictDetail", { detail: res.conflicts.map(fmtConflict).join("; ") }));
          router.refresh();
          return;
        }
        const key = res.error === "noAssignedDriver" ? "noAssignedDriver" : "dropFailed";
        setDropError(t(key));
      }
      router.refresh();
    });
  }

  // Drag a block back up to the queue: clear its car + driver(s).
  function unassign(bookingId: string) {
    setDropError(null);
    startTransition(async () => {
      const res = await unassignBookingAction(
        (() => { const fd = new FormData(); fd.append("bookingId", bookingId); return fd; })(),
      );
      if (!res.ok) setDropError(t("dropFailed"));
      router.refresh();
    });
  }

  function autoAssignAll() {
    if (work.length + conflictCount === 0) return;
    setResult(null);
    setDropError(null);
    startTransition(async () => {
      let assigned = 0;
      const failures: string[] = [];
      // 1) Place the unassigned / driverless queue.
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
      // 2) Re-match the loser of every overlap conflict among assigned trips.
      if (conflictCount > 0) {
        const fd = new FormData();
        fd.append("date", date);
        const cr = await resolveScheduleConflictsAction(fd);
        if (cr.ok) {
          assigned += cr.resolved;
          failures.push(...cr.failures);
        } else {
          failures.push(cr.error);
        }
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
    const bookingId = String(e.active.id);
    // Dropped squarely on a car row → (re)assign to that car.
    const onCar = over != null && vehicles.some((v) => v.id === over.id);
    if (onCar) {
      reassign(bookingId, String(over!.id));
      return;
    }
    // Anywhere else — the Unassigned zone, the gap above it, or off all rows —
    // means "take it off the car". Far-top queue droppables proved unreliable to
    // hit precisely, so we don't depend on it: not-a-car = unassign (only for a
    // block that currently has a car; a queue card with no car is a no-op).
    const b = bookings.find((x) => x.id === bookingId);
    if (b?.vehicleId) unassign(bookingId);
  }

  return (
    // id is REQUIRED: @dnd-kit derives the draggables' aria-describedby from it,
    // and without a stable value it falls back to a module counter that drifts
    // between SSR and client → hydration mismatch. Don't remove.
    <DndContext
      id="scheduler-board"
      sensors={sensors}
      // rectIntersection: pick the droppable the dragged block's OVERLAY overlaps
      // most. pointerWithin missed the queue (cursor stayed over a car row while
      // the overlay reached the queue); closestCenter overshot (the top queue's
      // centre is too far, so it always picked the nearest car → a reassign +
      // vehicleBusy). Overlap-based hits whatever the block is visually over —
      // the queue when dragged up to it, the row when over a row. Always-measure
      // keeps rects fresh in the horizontally-scrolling timeline.
      collisionDetection={rectIntersection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
          <button
            type="button"
            onClick={autoAssignAll}
            disabled={pending || work.length + conflictCount === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" aria-hidden />
            {pending ? t("assigning") : t("autoAssign", { count: work.length + conflictCount })}
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

        {/* Unassigned queue — drag a card onto a car row to assign it, or drag a
            scheduled block back here to unassign it. Also a drop target. */}
        <div
          ref={queueDrop.setNodeRef}
          className={`rounded-xl border bg-muted/30 p-3 transition-colors ${
            queueDrop.isOver ? "ring-2 ring-inset ring-primary/50 bg-primary/5" : ""
          }`}
        >
          <h2 className="mb-2 text-sm font-semibold">
            {t("queue")} <span className="text-muted-foreground">({queue.length})</span>
          </h2>
          {queue.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("queueEmptyDroppable")}</p>
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
                  unassignLabel={t("unassign")}
                  onUnassign={unassign}
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
