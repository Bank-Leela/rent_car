import { Star } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { EvaluationsListClient } from "@/components/admin/evaluations-list-client";

const RATING_TONE: Record<string, string> = {
  VERY_GOOD: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200",
  GOOD: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-200",
  SLIGHTLY_NOT_GOOD: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200",
  NOT_GOOD: "border-destructive/40 bg-destructive/10 text-destructive",
};

export default async function AdminEvaluations() {
  await requireAnyRole(["ADMIN", "APPROVER"]);
  const t = await getTranslations("adminEvaluations");
  const tr = await getTranslations("evaluationForm");

  const evaluations = await prisma.evaluation.findMany({
    orderBy: { submittedAt: "desc" },
    include: {
      trip: {
        include: {
          booking: {
            include: {
              requester: true,
              department: true,
              vehicle: true,
              primaryDriver: { include: { user: true } },
            },
          },
        },
      },
    },
  });

  // Aggregate counts per rating for the header summary.
  const totals = { VERY_GOOD: 0, GOOD: 0, SLIGHTLY_NOT_GOOD: 0, NOT_GOOD: 0 } as Record<string, number>;
  for (const e of evaluations) totals[e.rating] = (totals[e.rating] ?? 0) + 1;

  // Map to a flat, serializable shape for the client list (display + search).
  const evaluationRows = evaluations.map((e) => {
    const b = e.trip.booking;
    return {
      id: e.id,
      bookingId: b.id,
      jobNumber: b.jobNumber,
      rating: e.rating,
      purpose: b.purpose,
      requesterName: b.requester.name ?? b.requester.email,
      departmentName: b.department.nameEn,
      submittedAt: e.submittedAt,
      comment: e.comment,
      vehicleReg: b.vehicle?.registrationNumber ?? null,
      driverName: b.primaryDriver?.user.name ?? b.primaryDriver?.user.email ?? "",
      destination: b.destination,
      province: b.province,
      startAt: b.startAt,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["VERY_GOOD", "GOOD", "SLIGHTLY_NOT_GOOD", "NOT_GOOD"] as const).map((r) => (
          <div
            key={r}
            className={`rounded-xl border p-4 ${RATING_TONE[r]}`}
          >
            <div className="text-xs uppercase tracking-wide opacity-80">{tr(`ratings.${r}`)}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{totals[r] ?? 0}</div>
          </div>
        ))}
      </div>

      {evaluationRows.length === 0 ? (
        <EmptyState
          icon={Star}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <EvaluationsListClient evaluations={evaluationRows} />
      )}
    </div>
  );
}
