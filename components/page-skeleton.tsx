import { Skeleton } from "@/components/ui/skeleton";

// Route-level loading placeholder. Mirrors the common page shell (a PageHeader,
// a KPI/card row, then list rows) so navigating to a data-heavy page shows
// structure instantly instead of a blank while the RSC resolves. Each route
// group's `loading.tsx` renders this inside the AppShell, so the nav/chrome
// stays put and only the content area swaps to the skeleton.
export function PageSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-busy="true" aria-label="Loading">
      {/* PageHeader: title + description + an action button */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div className="space-y-2.5">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-[60vw]" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      {/* KPI / card row (dashboards, summaries) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>

      {/* List rows (queues, history, schedules) */}
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
