// Placement recommendation for a leftover (overflowed / unassigned) booking —
// the suggestion P'Top sees when the auto-solver couldn't place a trip. Pure;
// no I/O. The fairness order matches the solver/matcher (earnings ↑, then
// lastAssignedAt ↑). The recommendation OBEYS the same eligibility rule as the
// solver (`canChain`: no overlap, ≥2h gap to every existing trip, and the
// NORMAL one-morning + one-afternoon cap) — it must never suggest a slot that
// breaks the rules. Only P'Top may break them, by dragging the trip there by
// hand. If no non-duty car can legally take it, fall back to the duty car — the
// one car the rule lets overlap (the reclaim escalation P'Top decides on). For a
// >400 km trip a co-driver is also recommended: the next-fairest free non-duty
// driver who can legally take it (rides in the primary's car), or null if none.

import type { JobType } from "@prisma/client";
import { canChain } from "@/lib/booking/rotations";

export interface RecoDriver {
  driverId: string;
  /** Assigned car (car=driver). null = unpaired → not recommendable. */
  vehicleId: string | null;
  registrationNumber: string | null;
  driverName: string | null;
  earningsScore: number;
  lastAssignedAt: Date | null;
  /** The driver's other committed trips that day — checked against the booking
   *  for overlap + the 2h gap + the NORMAL cap (job-type aware). */
  trips: Array<{ startAt: Date; endAt: Date; jobType: JobType }>;
}

export interface RecoInput {
  booking: { startAt: Date; endAt: Date; jobType: JobType };
  /** >400 km trip → also recommend a co-driver. */
  needsSecondary: boolean;
  /** Excluded from the "free" pool; offered only as the reclaim fallback. */
  dutyDriverId: string | null;
  drivers: RecoDriver[];
}

interface Hit {
  driverId: string;
  vehicleId: string;
  driverName: string | null;
  registrationNumber: string | null;
  /** Recommended co-driver (>400 km). null when not needed or none free. */
  secondaryDriverId: string | null;
  secondaryDriverName: string | null;
}

export type Placement =
  | ({ kind: "fit" } & Hit)
  | ({ kind: "reclaim" } & Hit)
  | { kind: "none" };

export function recommendPlacement(input: RecoInput): Placement {
  const { booking, needsSecondary, dutyDriverId, drivers } = input;

  // A WERN (duty) slot belongs to the on-call driver — recommend them, not the
  // fair non-duty pool (which filters the duty driver out). Falls through if the
  // duty driver can't legally take it or none is rostered.
  if (booking.jobType === "WERN" && dutyDriverId) {
    const duty = drivers.find((d) => d.driverId === dutyDriverId && d.vehicleId && canChain(booking, d.trips));
    if (duty) {
      return {
        kind: "fit",
        driverId: duty.driverId,
        vehicleId: duty.vehicleId!,
        driverName: duty.driverName,
        registrationNumber: duty.registrationNumber,
        secondaryDriverId: null,
        secondaryDriverName: null,
      };
    }
  }

  const free = drivers
    .filter((d) => d.driverId !== dutyDriverId)
    .filter((d) => d.vehicleId)
    // Full eligibility, not just overlap: respects the ≥2h gap + NORMAL cap, so
    // the reco never proposes a rule-breaking slot.
    .filter((d) => canChain(booking, d.trips))
    .sort(
      (a, b) =>
        a.earningsScore - b.earningsScore ||
        (a.lastAssignedAt?.getTime() ?? -Infinity) - (b.lastAssignedAt?.getTime() ?? -Infinity) ||
        a.driverId.localeCompare(b.driverId),
    );

  let primary: RecoDriver | undefined = free[0];
  let kind: "fit" | "reclaim" = "fit";
  if (!primary) {
    // Nobody free → the duty car is the only one that may overlap (reclaim).
    primary = drivers.find((d) => d.driverId === dutyDriverId && d.vehicleId);
    kind = "reclaim";
  }
  if (!primary) return { kind: "none" };

  // Co-driver = next-fairest free non-duty driver (rides in the primary's car).
  let secondaryDriverId: string | null = null;
  let secondaryDriverName: string | null = null;
  if (needsSecondary) {
    const sec = free.find((d) => d.driverId !== primary!.driverId);
    if (sec) {
      secondaryDriverId = sec.driverId;
      secondaryDriverName = sec.driverName;
    }
  }

  return {
    kind,
    driverId: primary.driverId,
    vehicleId: primary.vehicleId!,
    driverName: primary.driverName,
    registrationNumber: primary.registrationNumber,
    secondaryDriverId,
    secondaryDriverName,
  };
}
