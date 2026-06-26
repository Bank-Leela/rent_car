import { PageSkeleton } from "@/components/page-skeleton";

// Shown while any REQUESTER page's server data resolves (my bookings, upcoming,
// history, detail). The AppShell from the group layout stays rendered.
export default function Loading() {
  return <PageSkeleton />;
}
