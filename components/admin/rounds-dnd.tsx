"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { reassignVehicleAction, unassignBookingAction } from "@/lib/booking/schedule-actions";
import { outsourceToRowAction, unoutsourceAction } from "@/lib/booking/adhoc-actions";

/**
 * Drag and drop for the rounds board.
 *
 * The whiteboard already had a per-chip move control (`round-reassign.tsx`) —
 * a menu of every other driver. That is exact but slow: it is the only way to
 * move a trip on the view P'Top actually lands on, and picking a name out of a
 * dropdown while looking at a board of rows is reading the board twice. The
 * timeline view has had dragging all along, so the gesture already exists in
 * this product; it just was not available on the default view.
 *
 * Nothing new is decided here. Every drop posts to the SAME server action the
 * menu posts to, so the no-overlap rule (§5 of docs/scheduling-algorithm.md)
 * still refuses a double-book on every car including the duty car, the 2 h
 * chaining gap stays overridable, and a rejected drop surfaces its conflict
 * instead of silently reverting.
 *
 * The id namespaces mirror the timeline's, deliberately — the two boards move
 * the same four things between the same three places, and one vocabulary for
 * both is one less thing to re-derive:
 *
 *   draggable  p:<bookingId>   a round sitting on a driver row (has a car)
 *              q:<bookingId>   an unplaced trip in the ยังไม่ได้จัดรถ bar
 *              x:<bookingId>   a trip on a hired outside vehicle
 *   droppable  car:<vehicleId> a driver row (car = driver)
 *              adhoc:<rowId>   a hired outside vehicle's row
 *              <queue>         the unassigned bar
 *
 * As on the timeline, "not a car and not a hired row" means take it off the car
 * rather than depending on hitting the queue box precisely: that droppable is a
 * thin strip at the top of a tall page and was unreliable to land on.
 */

export const ROUNDS_QUEUE_DROP = "rounds-queue";

type Kind = "p" | "q" | "x";

function split(raw: string): { kind: Kind; bookingId: string } | null {
  const [k, ...rest] = raw.split(":");
  if (k !== "p" && k !== "q" && k !== "x") return null;
  return { kind: k, bookingId: rest.join(":") };
}

export function RoundsDnd({ children }: { children: ReactNode }) {
  const t = useTranslations("scheduler");
  const router = useRouter();
  // distance:4 so a chip is still a link — a click that never moves is a click,
  // and the chips open the booking.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [active, setActive] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (error?: string) =>
    toast.error(
      t(
        error === "vehicleBusy" ? "dropConflict"
        : error === "noAssignedDriver" ? "noAssignedDriver"
        : "dropFailed",
      ),
    );

  async function run(fn: () => Promise<{ ok: boolean; error?: string; carriedForward?: number } | void>) {
    setBusy(true);
    try {
      const res = await fn();
      if (res && !res.ok) fail(res.error);
      // Attaching a recurring trip to a vendor carries it to the series' later
      // dates, which are not the day on screen — so it is said out loud.
      else if (res && (res.carriedForward ?? 0) > 0) {
        toast.success(t("externalCarriedForward", { count: res.carriedForward! }));
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  };

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const from = split(String(e.active.id));
    if (!from || busy) return;
    const overId = e.over ? String(e.over.id) : null;
    const vehicleId = overId?.startsWith("car:") ? overId.slice(4) : null;
    const rowId = overId?.startsWith("adhoc:") ? overId.slice(6) : null;
    const { kind, bookingId } = from;

    if (rowId) {
      return void run(() => outsourceToRowAction(form({ bookingId, rowId })));
    }
    // An outsourced trip dropped anywhere but another hired row comes back
    // in-house — same as the timeline. It does NOT land on the car it was
    // dropped on: un-outsourcing and assigning are two decisions, and doing
    // both silently would put a trip on a car P'Top never confirmed.
    if (kind === "x") {
      return void run(() => unoutsourceAction(form({ bookingId })));
    }
    if (vehicleId) {
      return void run(() => reassignVehicleAction(form({ bookingId, vehicleId })));
    }
    // Dropped off every row. Only a trip that HAS a car has anything to give up.
    if (kind === "p") {
      return void run(() => unassignBookingAction(form({ bookingId })));
    }
  }

  return (
    // id is REQUIRED: @dnd-kit derives aria-describedby from it, and without a
    // stable value it falls back to a module counter that drifts between SSR and
    // client → hydration mismatch. Same reason the timeline pins its own.
    <DndContext
      id="rounds-board"
      sensors={sensors}
      // rectIntersection, as on the timeline: hit whatever the dragged chip is
      // visually over. closestCenter overshoots on a board of tall rows.
      collisionDetection={rectIntersection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={(e: DragStartEvent) =>
        setActive({ id: String(e.active.id), label: String(e.active.data.current?.label ?? "") })
      }
      onDragCancel={() => setActive(null)}
      onDragEnd={onDragEnd}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {active ? (
          <span className="pointer-events-none rounded-lg border border-primary bg-popover px-2.5 py-1.5 text-xs font-medium shadow-lg">
            {active.label}
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** A trip that can be picked up. `label` is what the drag overlay shows. */
export function DragRound({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { label } });
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // The chips wrap links, and a link is natively draggable — the browser's
      // own drag would start instead of dnd-kit's and nothing would drop.
      onDragStartCapture={(e) => e.preventDefault()}
      className={`cursor-grab touch-none ${isDragging ? "opacity-40" : ""} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

function ring(isOver: boolean) {
  return isOver ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "";
}

/** A driver row. car = driver, so dropping here assigns that driver's own car. */
export function DropCarRow({
  vehicleId,
  className,
  children,
}: {
  vehicleId: string;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `car:${vehicleId}` });
  return (
    <li ref={setNodeRef} className={`${className ?? ""} ${ring(isOver)}`}>
      {children}
    </li>
  );
}

/** A hired outside vehicle's row. Dropping here hands the trip off the fleet. */
export function DropAdHocRow({
  rowId,
  className,
  children,
}: {
  rowId: string;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `adhoc:${rowId}` });
  return (
    <li ref={setNodeRef} className={`${className ?? ""} ${ring(isOver)}`}>
      {children}
    </li>
  );
}

/** The ยังไม่ได้จัดรถ bar — drop a placed round here to take it off its car. */
export function DropQueue({ className, children }: { className?: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: ROUNDS_QUEUE_DROP });
  return (
    <div ref={setNodeRef} className={`${className ?? ""} ${ring(isOver)} rounded-xl`}>
      {children}
    </div>
  );
}
