import { useTranslations } from "next-intl";
import type { BookingStatus } from "@prisma/client";

const STYLES: Record<BookingStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground ring-border",
  PENDING_APPROVAL:
    "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/40",
  // Distinct from both PENDING_APPROVAL (amber) and APPROVED (blue): the trip is
  // decided but still waiting on paperwork, which is its own kind of blocked.
  AWAITING_DOCUMENT:
    "bg-cyan-100 text-cyan-900 ring-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-200 dark:ring-cyan-900/40",
  APPROVED:
    "bg-blue-100 text-blue-900 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-900/40",
  ASSIGNED:
    "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900/40",
  DENIED:
    "bg-rose-100 text-rose-900 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900/40",
  CANCELLED: "bg-muted text-muted-foreground ring-border line-through",
  COMPLETED:
    "bg-violet-100 text-violet-900 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-900/40",
  WAITLIST:
    "bg-orange-100 text-orange-900 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-900/40",
  OUTSOURCED:
    "bg-zinc-200 text-zinc-800 ring-zinc-300 dark:bg-zinc-800/70 dark:text-zinc-200 dark:ring-zinc-700",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const t = useTranslations("status");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      {t(status)}
    </span>
  );
}
