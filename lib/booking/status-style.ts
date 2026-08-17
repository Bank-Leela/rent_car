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
    /** A filled bar with a border, for the day calendar's timeline lane. */
    bar: string;
  }
> = {
  DRAFT: {
    badge: "bg-muted text-muted-foreground ring-border",
    rail: "border-l-muted-foreground/70",
    dot: "bg-muted-foreground/50",
    bar: "bg-muted border-border text-muted-foreground",
  },
  PENDING_APPROVAL: {
    badge:
      "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/40",
    rail: "border-l-amber-700 dark:border-l-amber-500",
    dot: "bg-amber-600 dark:bg-amber-500",
    bar: "bg-amber-200 border-amber-400 text-amber-950 dark:bg-amber-500/30 dark:text-amber-100 dark:border-amber-400/40",
  },
  // Distinct from both PENDING_APPROVAL (amber) and APPROVED (blue): the trip is
  // decided but still waiting on paperwork, which is its own kind of blocked.
  AWAITING_DOCUMENT: {
    badge:
      "bg-cyan-100 text-cyan-900 ring-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-200 dark:ring-cyan-900/40",
    rail: "border-l-cyan-600 dark:border-l-cyan-500",
    dot: "bg-cyan-600 dark:bg-cyan-500",
    bar: "bg-cyan-200 border-cyan-400 text-cyan-950 dark:bg-cyan-500/30 dark:text-cyan-100 dark:border-cyan-400/40",
  },
  APPROVED: {
    badge:
      "bg-blue-100 text-blue-900 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-900/40",
    rail: "border-l-blue-600 dark:border-l-blue-500",
    dot: "bg-blue-600 dark:bg-blue-500",
    bar: "bg-blue-200 border-blue-400 text-blue-950 dark:bg-blue-500/30 dark:text-blue-100 dark:border-blue-400/40",
  },
  ASSIGNED: {
    badge:
      "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900/40",
    rail: "border-l-emerald-600 dark:border-l-emerald-500",
    dot: "bg-emerald-600 dark:bg-emerald-500",
    bar: "bg-emerald-200 border-emerald-400 text-emerald-950 dark:bg-emerald-500/30 dark:text-emerald-100 dark:border-emerald-400/40",
  },
  DENIED: {
    badge:
      "bg-rose-100 text-rose-900 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900/40",
    rail: "border-l-rose-600 dark:border-l-rose-500",
    dot: "bg-rose-600 dark:bg-rose-500",
    bar: "bg-rose-200 border-rose-400 text-rose-950 dark:bg-rose-500/30 dark:text-rose-100 dark:border-rose-400/40",
  },
  CANCELLED: {
    badge: "bg-muted text-muted-foreground ring-border line-through",
    rail: "border-l-muted-foreground/70",
    dot: "bg-muted-foreground/50",
    bar: "bg-muted border-border text-muted-foreground line-through",
  },
  COMPLETED: {
    badge:
      "bg-violet-100 text-violet-900 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-900/40",
    rail: "border-l-violet-600 dark:border-l-violet-500",
    dot: "bg-violet-600 dark:bg-violet-500",
    bar: "bg-violet-200 border-violet-300 text-violet-950 dark:bg-violet-500/25 dark:text-violet-100 dark:border-violet-400/30",
  },
  WAITLIST: {
    badge:
      "bg-orange-100 text-orange-900 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-900/40",
    rail: "border-l-orange-600 dark:border-l-orange-500",
    dot: "bg-orange-600 dark:bg-orange-500",
    bar: "bg-orange-200 border-orange-400 text-orange-950 dark:bg-orange-500/30 dark:text-orange-100 dark:border-orange-400/40",
  },
  OUTSOURCED: {
    badge:
      "bg-zinc-200 text-zinc-800 ring-zinc-300 dark:bg-zinc-800/70 dark:text-zinc-200 dark:ring-zinc-700",
    rail: "border-l-zinc-500 dark:border-l-zinc-400",
    dot: "bg-zinc-500 dark:bg-zinc-400",
    bar: "bg-zinc-200 border-zinc-400 text-zinc-900 dark:bg-zinc-600/40 dark:text-zinc-100 dark:border-zinc-500/50",
  },
};

/**
 * What the REQUESTER is shown, which is deliberately less than what staff see.
 *
 * The stored status tracks the office's internal pipeline: PENDING_APPROVAL →
 * AWAITING_DOCUMENT (approved, waiting for the signed official form to come
 * back and an admin to confirm it) → APPROVED → ASSIGNED. Only three of those
 * stages mean anything to the person who filed the request: they are waiting,
 * it is approved, or a car is theirs. "รอเอกสารอนุมัติ" and "รอคิว" are the
 * office's own bookkeeping — both are, from the requester's side, still waiting,
 * and printing them as separate states invites the question "what document?"
 * about paperwork the requester never handles (the form is printed, signed and
 * filed by the transport office; there is no upload on the requester's side).
 *
 * Only the wait collapses. OUTSOURCED stays its own badge — the requester ASKED
 * for an outside rental when the fleet is full, so "the fleet could not take it
 * and you are getting a hired car" is their answer, not internal bookkeeping —
 * and the three terminal states (COMPLETED / DENIED / CANCELLED) are outcomes,
 * not stages.
 *
 * Staff surfaces keep the raw status: admin has a whole queue section keyed on
 * AWAITING_DOCUMENT, and confirming that document is what runs จัด.
 */
export function requesterFacingStatus(status: BookingStatus): BookingStatus {
  switch (status) {
    case "DRAFT":
    case "WAITLIST":
    case "AWAITING_DOCUMENT":
      return "PENDING_APPROVAL";
    default:
      return status;
  }
}

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
