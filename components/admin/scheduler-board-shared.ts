import type { JobType } from "@prisma/client";

// Shared types, theme, and axis geometry for the scheduler board. Split out of
// scheduler-board.tsx so the board, its block subcomponents, and the page can
// all share one source of truth. Pure data/helpers — no client hooks.

export type SchedulerVehicle = {
  id: string;
  registrationNumber: string;
  // car=driver: the car's fixed driver. null only for an unpaired car.
  driverName: string | null;
};

export type SchedulerBooking = {
  id: string;
  jobNumber: string;
  purpose: string;
  destination: string;
  // Sub-project A (presentation only): campus/off-campus bit + stored Maps link.
  // Optional so non-admin board construction sites needn't set them.
  outsideChula?: boolean;
  googleMapsUrl?: string | null;
  // No-wait split: leg 2 (return pickup) rendered as a read-only ghost; the
  // primary block above is clamped to leg 1. null for waiting/single-interval trips.
  returnLeg?: { startHour: number; endHour: number; timeLabel: string; endLabel: string } | null;
  // Start as "HH:mm", or "↪ <date>" when the trip began on an earlier day.
  timeLabel: string;
  // End time as "HH:mm", with "↩ <return date>" when it ends on a later day.
  endLabel: string;
  // Full departure / arrival as "<weekday> <date> <time>" (e.g. "อ. 22 มิ.ย. 06:00").
  // For a multi-day trip the block shows these pinned to its two ends so the whole
  // span (which day → which day, depart time, arrive time) is visible on any day.
  departLabel: string;
  arriveLabel: string;
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
  // Long-haul (>400km) trip that's assigned (car + primary) but has NO co-driver
  // yet — surfaced as a "parked" co-driver card in the queue, draggable onto a
  // car to fill the slot. Set when a co-driver is dragged off, or never assigned.
  needsCoDriver: boolean;
};

// Per-job-type colour, tuned for both light and dark themes. Fills + borders
// only — the conflict (red) and co-driver (violet) cues stay as rings so they
// never clash with these. TJW=ค้างคืน, OT=ล่วงเวลา, WERN=เวร, NORMAL=ทั่วไป.
export const JOB_COLOR: Record<string, { block: string; dot: string; label: string }> = {
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
export const jobStyle = (jt: string) => JOB_COLOR[jt] ?? JOB_COLOR.NORMAL!;
export const JOB_LEGEND = ["TJW", "OT", "WERN", "NORMAL"] as const;

// Cars are shown as A, B, C… (index → letter) instead of plate numbers.
export const carLabel = (i: number) => String.fromCharCode(65 + i);

// The axis spans the full day, 00:00–24:00. (Kept as min/max bounds so a stray
// out-of-range value can never clamp a block off-screen.)
export const DEFAULT_START = 0;
export const DEFAULT_END = 24;
// Small gutter on each side so the 00:00 / 24:00 edge labels (and end-of-day
// blocks) don't collide with the rounded frame. Labels, gridlines, and blocks
// all map through this, so they stay aligned.
export const AXIS_PAD = 3;
export const pctOf = (h: number, start: number, hours: number) => {
  const f = Math.max(0, Math.min(1, (h - start) / hours));
  return AXIS_PAD + f * (100 - 2 * AXIS_PAD);
};

// Vertical geometry for stacking concurrent trips: each overlap lane is a sub-row
// of LANE_PX, with LANE_PAD breathing room top/bottom inside it.
export const LANE_PX = 64;
export const LANE_PAD = 4;
