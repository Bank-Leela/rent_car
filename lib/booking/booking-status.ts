import { BookingStatus } from "@prisma/client";

// A booking whose driver assignment counts as a real commitment for the next
// solve's availability + fairness.
//
// The board single-matcher leaves a *claimed* trip at status APPROVED
// (driverScheduleStatus CLAIMED) with the driver set; the batch solver confirms
// it to ASSIGNED. Queries that filtered only ASSIGNED|COMPLETED missed claimed
// trips entirely — so a driver already committed (e.g. still away on a multi-day
// TJW claimed via the board) looked BOTH free (→ re-assigned while still out)
// and idle (→ uncounted in earnings, so picked again). Counting APPROVED here
// closes that gap. DRAFT / PENDING_APPROVAL / DENIED / CANCELLED / WAITLIST are
// not commitments.
//
// Always pair with a `primaryDriverId`/`secondaryDriverId` filter so an
// APPROVED-but-unassigned (pending) booking is never mistaken for a commitment.
export const COMMITTED_STATUSES: BookingStatus[] = [
  BookingStatus.APPROVED,
  BookingStatus.ASSIGNED,
  BookingStatus.COMPLETED,
];

/**
 * A booking a dispatch action may still put a car and driver on.
 *
 * COMMITTED_STATUSES is the wrong list for that question — it includes
 * COMPLETED, which already happened and must not be re-dispatched (§9b), and it
 * is about "does this count against availability", not "may I write to it".
 *
 * The gap this closes: `reassignVehicleAction` read no status at all, so a
 * CANCELLED or DENIED booking that still carried an `overflowReason` was listed
 * on /admin/batch with a one-click assign that committed a real car and driver
 * to a trip nobody wanted — and the VehicleOccupancy row it wrote then blocked a
 * real booking on that car.
 */
export const DISPATCHABLE_STATUSES: BookingStatus[] = [
  BookingStatus.APPROVED,
  BookingStatus.ASSIGNED,
];
