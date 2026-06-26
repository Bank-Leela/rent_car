import { PageSkeleton } from "@/components/page-skeleton";

// Shown while any DRIVER page's server data resolves (today, board, calendar,
// schedule). The AppShell from the group layout stays rendered.
export default function Loading() {
  return <PageSkeleton />;
}
