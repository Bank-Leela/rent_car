import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    // This component IS what "the site looks empty" was pointing at: a dashed
    // grey box holding a grey circle, a 16px title and a grey line. It is the
    // FIRST thing a brand-new requester sees, so it was the app introducing
    // itself with its blankest possible surface.
    //
    // Now it is a real panel: solid card with elevation (dashed borders read as a
    // dropzone or an unfinished state, neither of which is true), an
    // indigo-tinted icon plate at 56px, and a title at display scale. Still
    // centred and still quiet — an empty state should not shout — but it now has
    // presence instead of absence.
    <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-12 text-center shadow-e1 sm:px-10 sm:py-16">
      {/* A single soft indigo bloom behind the icon. Bounded and behind content,
          so unlike a page-wide wash it gives the panel a centre of gravity. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-56 w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
          <Icon className="h-7 w-7" aria-hidden />
        </div>
        <h3 className="text-xl font-semibold tracking-[-0.01em]">{title}</h3>
        {description && (
          <p className="mx-auto mt-2 max-w-md text-[0.9375rem] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
