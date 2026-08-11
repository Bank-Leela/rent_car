// Triage signals for the approver queue: cheap, at-a-glance risk/capacity flags
// so an approver can decide WHICH pending request to open first without opening
// any. Pure — reuses the existing rule helpers (source of truth); the queue page
// feeds it data already in hand.
import { differenceInHours } from "date-fns";
import { isWithinWorkHours, checkLeadTime, shouldWarnAboutCancellations } from "@/lib/booking/rules";

export type TriageFlag =
  | { key: "emergency" }
  | { key: "outOfHours" }
  | { key: "shortLead" }
  | { key: "dayFull" }
  | { key: "repeatCanceller"; count: number };

export type TriageInput = {
  startAt: Date;
  endAt: Date;
  province: string;
  isEmergency: boolean;
  now: Date;
  /**
   * Whether the placement engine can find a car for THIS trip on its day —
   * `dayHasRoomForMany`, the same question the approve button asks.
   *
   * This used to be a slot count (`isFull(dayUsed, dayCapacity)`), which is a
   * different question with a different answer: the count is a coarse "how many
   * trips fit in a day" from submission time, while the approve asks whether a
   * legal car exists for this specific trip given the 2 h gap, the NORMAL cap and
   * overlap. A card could read "วันเต็ม 13/12" and approve without complaint, or
   * look free and be refused. Now the chip and the button agree by construction.
   */
  fleetFull: boolean;
  /** the requester's cancellations in the past 90 days. */
  cancellations: number;
};

export function triageFlags(b: TriageInput): TriageFlag[] {
  const flags: TriageFlag[] = [];
  if (b.isEmergency) flags.push({ key: "emergency" });
  if (!isWithinWorkHours({ startAt: b.startAt, endAt: b.endAt })) flags.push({ key: "outOfHours" });
  if (!checkLeadTime({ startAt: b.startAt, province: b.province, now: b.now }).ok) {
    flags.push({ key: "shortLead" });
  }
  if (b.fleetFull) flags.push({ key: "dayFull" });
  if (shouldWarnAboutCancellations(b.cancellations)) {
    flags.push({ key: "repeatCanceller", count: b.cancellations });
  }
  return flags;
}

// Hours a request has been waiting since submission. Drives the aging chip and
// the SLA banner. Floored at 0 so clock skew never shows negative time.
export function waitingHours(createdAt: Date, now: Date): number {
  return Math.max(0, differenceInHours(now, createdAt));
}

// Past this many hours waiting, a pending request is "overdue" (amber). Double
// it (48h) and the per-card chip escalates to rose.
export const SLA_WARN_HOURS = 24;
