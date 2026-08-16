import type { BookingStatus } from "@prisma/client";

/**
 * One status, one colour, everywhere it is drawn.
 *
 * This existed twice and the two copies disagreed. `BookingStatusBadge` had all
 * ten statuses keyed `Record<BookingStatus, …>`; the month calendar had its own
 * `STATUS_TINT` keyed `Record<string, …>` with six, read as `TINT[status] ?? ""`.
 * `string` keys mean TypeScript checks nothing, so when AWAITING_DOCUMENT,
 * WAITLIST and OUTSOURCED were added the badge was updated and the calendar was
 * not — and it never failed to build. AWAITING_DOCUMENT and OUTSOURCED are the
 * 2nd and 4th most common statuses in the database; a third of every month's
 * bookings were drawing with no status colour at all, in a grid whose entire job
 * is to show status at a glance.
 *
 * So the key type is the point of this file, not the palette. `Record<BookingStatus, …>`
 * is exhaustive: adding a status to the enum fails the build here until it is
 * given a colour, which is the only way this stops happening a third time.
 *
 * Three weights of the same hue, because the two surfaces are not the same
 * shape — a badge is a standalone object and can be filled, while a calendar
 * cell stacks five rows and would become a wall of colour if each were. Same
 * decision as JOB_COLOR's `block`/`dot` split in scheduler-board-shared.ts.
 *
 * These stay raw Tailwind hues rather than moving to the `--urgent` family:
 * booking status is its own working vocabulary, as `components/urgent-note.tsx`
 * spells out. An amber booking and an amber warning mean different things.
 */
export const STATUS_STYLE: Record<
  BookingStatus,
  {
    /** Filled, for a badge standing on its own. */
    badge: string;
    /** A 2px edge, for a row in a dense list. Light and dark are one step
        apart: no single mid-tone clears 3:1 on both a light and a dark pill —
        -500 measured as low as 2.01:1 in light, and the rail is the only thing
        encoding status in the month grid. */
    rail: string;
    /** A dot, for a legend entry. */
    dot: string;
  }
> = {
  DRAFT: {
    badge: "bg-muted text-muted-foreground ring-border",
    rail: "border-l-muted-foreground/70",
    dot: "bg-muted-foreground/50",
  },
  PENDING_APPROVAL: {
    badge:
      "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/40",
    rail: "border-l-amber-700 dark:border-l-amber-500",
    dot: "bg-amber-600 dark:bg-amber-500",
  },
  // Distinct from both PENDING_APPROVAL (amber) and APPROVED (blue): the trip is
  // decided but still waiting on paperwork, which is its own kind of blocked.
  AWAITING_DOCUMENT: {
    badge:
      "bg-cyan-100 text-cyan-900 ring-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-200 dark:ring-cyan-900/40",
    rail: "border-l-cyan-600 dark:border-l-cyan-500",
    dot: "bg-cyan-600 dark:bg-cyan-500",
  },
  APPROVED: {
    badge:
      "bg-blue-100 text-blue-900 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-900/40",
    rail: "border-l-blue-600 dark:border-l-blue-500",
    dot: "bg-blue-600 dark:bg-blue-500",
  },
  ASSIGNED: {
    badge:
      "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900/40",
    rail: "border-l-emerald-600 dark:border-l-emerald-500",
    dot: "bg-emerald-600 dark:bg-emerald-500",
  },
  DENIED: {
    badge:
      "bg-rose-100 text-rose-900 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900/40",
    rail: "border-l-rose-600 dark:border-l-rose-500",
    dot: "bg-rose-600 dark:bg-rose-500",
  },
  CANCELLED: {
    badge: "bg-muted text-muted-foreground ring-border line-through",
    rail: "border-l-muted-foreground/70",
    dot: "bg-muted-foreground/50",
  },
  COMPLETED: {
    badge:
      "bg-violet-100 text-violet-900 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-900/40",
    rail: "border-l-violet-600 dark:border-l-violet-500",
    dot: "bg-violet-600 dark:bg-violet-500",
  },
  WAITLIST: {
    badge:
      "bg-orange-100 text-orange-900 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-900/40",
    rail: "border-l-orange-600 dark:border-l-orange-500",
    dot: "bg-orange-600 dark:bg-orange-500",
  },
  OUTSOURCED: {
    badge:
      "bg-zinc-200 text-zinc-800 ring-zinc-300 dark:bg-zinc-800/70 dark:text-zinc-200 dark:ring-zinc-700",
    rail: "border-l-zinc-500 dark:border-l-zinc-400",
    dot: "bg-zinc-500 dark:bg-zinc-400",
  },
};

/**
 * Statuses the month calendar can show, in the order the legend lists them —
 * roughly the life of a booking, with the two dead ends last.
 *
 * DRAFT is absent on purpose: the calendar query excludes it, so listing it
 * would advertise a colour that can never appear in the grid.
 */
export const CALENDAR_STATUS_LEGEND = [
  "PENDING_APPROVAL",
  "AWAITING_DOCUMENT",
  "APPROVED",
  "ASSIGNED",
  "OUTSOURCED",
  "WAITLIST",
  "COMPLETED",
  "CANCELLED",
  "DENIED",
] as const satisfies readonly BookingStatus[];
