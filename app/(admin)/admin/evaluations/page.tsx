import Link from "next/link";
import { format } from "date-fns";
import { Star } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";

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

      {evaluations.length === 0 ? (
        <EmptyState
          icon={Star}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul className="space-y-3">
          {evaluations.map((e) => {
            const b = e.trip.booking;
            return (
              <li key={e.id}>
                <Card>
                  <CardContent className="pt-5 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{b.jobNumber}</span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RATING_TONE[e.rating]}`}
                          >
                            {tr(`ratings.${e.rating}`)}
                          </span>
                        </div>
                        <div className="mt-1 font-medium">{b.purpose}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {b.requester.name ?? b.requester.email} · {b.department.nameEn} ·{" "}
                          {t("submittedAt", { date: format(e.submittedAt, "d MMM yyyy HH:mm") })}
                        </div>
                      </div>
                      <Link
                        href={`/admin/${b.id}`}
                        className="shrink-0 rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-muted"
                      >
                        {t("openBooking")}
                      </Link>
                    </div>
                    {e.comment && (
                      <blockquote className="rounded-md border-l-2 border-muted bg-muted/30 px-3 py-2 text-sm">
                        {e.comment}
                      </blockquote>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
                      <span>
                        {t("vehicle")}: {b.vehicle?.registrationNumber ?? "—"}
                      </span>
                      <span>
                        {t("driver")}: {b.primaryDriver?.user.name ?? b.primaryDriver?.user.email ?? "—"}
                      </span>
                      <span>{t("destination")}: {b.destination}, {b.province}</span>
                      <span>
                        {t("tripDate")}: {format(b.startAt, "d MMM yyyy")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
