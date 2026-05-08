import Link from "next/link";
import { format } from "date-fns";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { BookingStatusBadge } from "@/components/booking-status-badge";

export default async function ApproverInbox() {
  const session = await requireRole("APPROVER");

  // Approvable departments: ones where I'm the head, or the head delegates to me.
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pending approvals</h1>
        <p className="text-muted-foreground">
          {pending.length === 0 ? "Inbox empty." : `${pending.length} awaiting your decision.`}
        </p>
      </div>

      {pending.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nothing to approve right now.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {pending.map((b) => (
            <Link
              key={b.id}
              href={`/approver/${b.id}`}
              className="block rounded-lg border bg-card p-4 hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-muted-foreground">{b.jobNumber}</span>
                    <BookingStatusBadge status={b.status} />
                  </div>
                  <div className="mt-1 font-medium">{b.purpose}</div>
                  <div className="text-sm text-muted-foreground">
                    {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM HH:mm")} → {format(b.endAt, "EEE d MMM HH:mm")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {b.requester.name ?? b.requester.email} · {b.department.nameEn} · submitted {format(b.createdAt, "d MMM HH:mm")}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
