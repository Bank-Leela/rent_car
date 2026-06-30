"use server";

import { revalidatePath } from "next/cache";
import type { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-helpers";
import { logTransition } from "@/lib/booking/audit";
import { reassignVehicleAction, unassignBookingAction } from "@/lib/booking/schedule-actions";
import type { ActionResult } from "@/lib/booking/actions";

// A booking can only be staged/applied while it's still schedulable. A trip P'Top
// has since denied / cancelled / completed / outsourced is dead — a lingering
// draft must never resurrect it.
const SCHEDULABLE = ["APPROVED", "ASSIGNED"] as const;
type Schedulable = (typeof SCHEDULABLE)[number];
const isSchedulable = (s: string): s is Schedulable => (SCHEDULABLE as readonly string[]).includes(s);

// Driver-side draft/trade actions (propose / submit / reset / withdraw) were
// removed: the station no longer self-schedules — P'Top decides every assignment
// directly on the admin board. The ADMIN apply/dismiss below stay so any draft
// already in flight at the cutover can still be cleared; with no new submissions
// the admin review panel is gated off (it only renders when drafts exist).

// ADMIN: apply the submitted driver draft to the real schedule. Each move is
// committed via the canonical reassign / unassign actions, so a trade can never
// diverge from a manual drag (inherits overlap guard, claim teardown, rotation
// recompute, lastAssignedAt, active-driver checks). Applied in TWO phases so an
// intra-batch swap (A↔B trading same-time cars) doesn't deadlock on the overlap
// check: every validated mover is first DETACHED to the queue, freeing the slots,
// then the car-targets are REATTACHED against the now-correct state.
export async function applyDraftAction(): Promise<ActionResult & { applied?: number; skipped?: number }> {
  const session = await requireRole("ADMIN");
  const drafts = await prisma.bookingDraft.findMany({
    where: { submitted: true },
    select: { bookingId: true, proposedVehicleId: true, booking: { select: { status: true } } },
  });

  // Validate every move up front so we only detach bookings we can actually place.
  const queueMoves: { bookingId: string }[] = [];
  const carMoves: { bookingId: string; vehicleId: string; status: BookingStatus }[] = [];
  const deadIds: string[] = []; // terminal booking → drop the dead draft, don't resurrect
  for (const d of drafts) {
    if (!isSchedulable(d.booking.status)) {
      deadIds.push(d.bookingId);
      continue;
    }
    if (!d.proposedVehicleId) {
      queueMoves.push({ bookingId: d.bookingId });
      continue;
    }
    // A proposed car must be active and have an active assigned driver, else the
    // move can't dispatch — keep its draft pending (never detach it).
    const v = await prisma.vehicle.findUnique({
      where: { id: d.proposedVehicleId },
      select: {
        isActive: true,
        assignedDriverId: true,
        assignedDriver: { select: { isActive: true, user: { select: { isActive: true } } } },
      },
    });
    const driverOk =
      v?.isActive && v.assignedDriverId && v.assignedDriver?.isActive && v.assignedDriver.user?.isActive;
    if (!driverOk) continue;
    carMoves.push({ bookingId: d.bookingId, vehicleId: d.proposedVehicleId, status: d.booking.status });
  }

  // Phase 1 — detach every validated mover from its current car (canonical
  // unassign: releases claims, recomputes rotation, logs UNASSIGNED). After this,
  // a swapped pair's slots are both free so neither blocks the other.
  for (const m of [...queueMoves, ...carMoves]) {
    const fd = new FormData();
    fd.set("bookingId", m.bookingId);
    await unassignBookingAction(fd);
  }

  let applied = 0;
  const appliedIds: string[] = [];
  // Queue moves are complete — detached == back in the queue.
  for (const m of queueMoves) {
    applied += 1;
    appliedIds.push(m.bookingId);
  }

  // Phase 2 — reattach the car-targets (canonical reassign: overlap-checked
  // against the now-correct state). A genuine clash with a NON-batch trip leaves
  // the booking detached (in the queue) and its draft pending for P'Top.
  for (const m of carMoves) {
    const fd = new FormData();
    fd.set("bookingId", m.bookingId);
    fd.set("vehicleId", m.vehicleId);
    const res = await reassignVehicleAction(fd);
    if (res.ok) {
      applied += 1;
      appliedIds.push(m.bookingId);
      await logTransition({
        bookingId: m.bookingId,
        actorUserId: session.user.id,
        fromStatus: m.status,
        toStatus: "ASSIGNED",
        action: "DRAFT_APPLIED",
      });
    }
  }

  // Remove committed + dead drafts; leave busy/unpaired ones submitted for review.
  await prisma.bookingDraft.deleteMany({ where: { bookingId: { in: [...appliedIds, ...deadIds] } } });
  revalidatePath("/admin/schedule");
  revalidatePath("/driver/schedule");
  // skipped = drafts that remain pending (busy/unpaired) — excludes applied AND dead.
  return { ok: true, applied, skipped: drafts.length - applied - deadIds.length };
}

// ADMIN: dismiss the submitted draft without applying.
export async function dismissDraftAction(): Promise<ActionResult> {
  await requireRole("ADMIN");
  await prisma.bookingDraft.deleteMany({ where: { submitted: true } });
  revalidatePath("/admin/schedule");
  revalidatePath("/driver/schedule");
  return { ok: true };
}
