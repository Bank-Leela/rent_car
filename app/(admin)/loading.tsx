import { PageSkeleton } from "@/components/page-skeleton";

// Shown while any ADMIN/APPROVER page's server data resolves (queue, schedule,
// calendar, dashboard, …). The AppShell from the group layout stays rendered.
export default function Loading() {
  return <PageSkeleton />;
}
