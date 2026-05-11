import Link from "next/link";
import { format } from "date-fns";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { BookingStatusBadge } from "@/components/booking-status-badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default async function ApproverInbox() {
  const session = await requireRole("APPROVER");
  const t = await getTranslations("approver");

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

  // Order by trip date — the approver cares about urgency, not submission order.
  const pending = deptIds.length
    ? await prisma.booking.findMany({
        where: { status: "PENDING_APPROVAL", departmentId: { in: deptIds } },
        orderBy: { startAt: "asc" },
        include: { requester: true, department: true },
      })
    : [];

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={pending.length === 0 ? t("subEmpty") : t("subWithCount", { count: pending.length })}
      />

      {pending.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
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
                    {b.requester.name ?? b.requester.email} · {b.department.nameEn}
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
