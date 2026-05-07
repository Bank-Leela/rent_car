import { Badge } from "@/components/ui/badge";
import type { BookingStatus } from "@prisma/client";

const STYLES: Record<BookingStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "Draft", variant: "outline" },
  PENDING_APPROVAL: { label: "Pending approval", variant: "secondary" },
  APPROVED: { label: "Approved", variant: "default" },
  ASSIGNED: { label: "Assigned", variant: "default" },
  DENIED: { label: "Denied", variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "outline" },
  COMPLETED: { label: "Completed", variant: "secondary" },
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const { label, variant } = STYLES[status];
  return <Badge variant={variant}>{label}</Badge>;
}
