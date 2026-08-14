import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "This needs your attention."
 *
 * The `--urgent` / `--urgent-surface` / `--urgent-foreground` trio was added so
 * urgency would be one colour everywhere, and then almost nothing used it: an
 * audit counted 293 amber utility occurrences across 33 files, every one of them
 * a hand-rolled `border-amber-300 bg-amber-50 … text-amber-900` with its own
 * `dark:` override. On the worst pages four or five different ambers appeared at
 * once, so "urgent" carried no consistent meaning.
 *
 * A shared component rather than a find-and-replace, because a replace leaves
 * the next callout to be hand-rolled again. The `dark:` overrides are deleted
 * rather than translated — the tokens already swap themselves.
 *
 * NOT for: a job type (JOB_COLOR.OT is amber), a booking status
 * (BookingStatusBadge paints PENDING_APPROVAL amber), or a rating (star-rating).
 * Those are three separate working vocabularies that happen to share a hue.
 * Apply this by meaning, never by grepping for "amber".
 */
export function UrgentNote({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon?: LucideIcon;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-urgent/40 bg-urgent-surface p-4 text-sm text-urgent-foreground shadow-e1",
        className,
      )}
    >
      {Icon && (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-urgent/15 text-urgent">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
