import Link from "next/link";
import { format } from "date-fns";
import { CheckCircle2, XCircle, ClipboardList, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ApprovalStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

const FILTERS = ["all", "approved", "denied"] as const;
type Filter = (typeof FILTERS)[number];

// Approver-scoped audit: every booking this approver approved or denied, with
// their own reason inline (otherwise write-only). Self-contained additive page.
export default async function ApproverDecisions({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await requireRole("ADMIN");
  const t = await getTranslations("decisions");
  const { filter: filterParam } = await searchParams;
  const filter: Filter = FILTERS.includes(filterParam as Filter) ? (filterParam as Filter) : "all";

  const statusWhere: ApprovalStatus[] =
    filter === "approved" ? ["APPROVED"] : filter === "denied" ? ["DENIED"] : ["APPROVED", "DENIED"];

  const decisions = await prisma.approval.findMany({
    where: { approverId: session.user.id, status: { in: statusWhere } },
    orderBy: { decidedAt: "desc" },
    include: { booking: { include: { requester: true, department: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f === filter;
          return (
            <Link
              key={f}
              href={f === "all" ? "/admin/decisions" : `/admin/decisions?filter=${f}`}
              className={`inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              {t(`filter_${f}`)}
            </Link>
          );
        })}
      </div>

      {decisions.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <ul className="space-y-2">
          {decisions.map((d) => {
            const b = d.booking;
            const approved = d.status === "APPROVED";
            return (
              <li key={d.id}>
                <Link
                  href={`/admin/${b.id}`}
                  className="group flex items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                          approved
                            ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200"
                            : "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200"
                        }`}
                      >
                        {approved ? (
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {approved ? t("approved") : t("denied")}
                      </span>
                      {d.decidedAt && (
                        <span className="text-xs text-muted-foreground">
                          {t("decidedOn", { date: format(d.decidedAt, "d MMM yyyy HH:mm") })}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-medium truncate">{b.purpose}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {b.destination}, {b.province} · {format(b.startAt, "EEE d MMM HH:mm")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {b.requester.name ?? b.requester.email} · {b.department.nameEn}
                    </div>
                    {d.comment && (
                      <p className="mt-1.5 rounded-md bg-muted/60 px-2 py-1 text-sm text-muted-foreground">
                        “{d.comment}”
                      </p>
                    )}
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
