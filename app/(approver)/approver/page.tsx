import Link from "next/link";
import { format } from "date-fns";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default async function ApproverInbox() {
  const session = await requireRole("APPROVER");

  const ownDepts = await prisma.department.findMany({
    where: {
      OR: [
        { headUserId: session.user.id },
        { head: { delegatedToUserId: session.user.id } },
      ],
    },
    select: { id: true, nameEn: true },
  });
  const deptIds = ownDepts.map((d) => d.id);

  const pending = deptIds.length
    ? await prisma.booking.findMany({
        where: { status: "PENDING_APPROVAL", departmentId: { in: deptIds } },
        orderBy: { createdAt: "asc" },
        include: { requester: true, department: true },
      })
    : [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Pending approvals"
        description={
          pending.length === 0
            ? "Nothing to review right now."
            : `${pending.length} booking${pending.length === 1 ? "" : "s"} awaiting your decision.`
        }
      />

      {pending.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Inbox empty"
          description="When someone in your department submits a booking, it'll land here."
        />
      ) : (
        <ul className="space-y-2">
          {pending.map((b) => (
            <li key={b.id}>
              <Link
                href={`/approver/${b.id}`}
                className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                    <BookingStatusBadge status={b.status} />
                  </div>
                  <div className="mt-1 font-medium truncate">{b.purpose}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM HH:mm")} → {format(b.endAt, "EEE d MMM HH:mm")}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {b.requester.name ?? b.requester.email} · {b.department.nameEn} · submitted {format(b.createdAt, "d MMM HH:mm")}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
