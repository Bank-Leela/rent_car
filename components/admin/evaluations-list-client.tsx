"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { ListSearch } from "@/components/list-search";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";

const RATING_TONE: Record<string, string> = {
  VERY_GOOD: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200",
  GOOD: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-200",
  SLIGHTLY_NOT_GOOD: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200",
  NOT_GOOD: "border-destructive/40 bg-destructive/10 text-destructive",
};

export interface EvaluationRow {
  id: string;
  bookingId: string;
  jobNumber: string;
  rating: string;
  purpose: string;
  requesterName: string;
  departmentName: string;
  submittedAt: Date;
  comment: string | null;
  vehicleReg: string | null;
  driverName: string;
  destination: string;
  province: string;
  startAt: Date;
}

export function EvaluationsListClient({ evaluations }: { evaluations: EvaluationRow[] }) {
  const t = useTranslations("adminEvaluations");
  const tr = useTranslations("evaluationForm");
  const ts = useTranslations("listSearch");

  return (
    <ListSearch
      items={evaluations}
      keys={["jobNumber", "driverName"]}
      render={(rows) =>
        rows.length === 0 ? (
          <EmptyState icon={Star} title={ts("noMatches")} />
        ) : (
          <ul className="space-y-3">
            {rows.map((e) => (
              <li key={e.id}>
                <Card>
                  <CardContent className="pt-5 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{e.jobNumber}</span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RATING_TONE[e.rating]}`}
                          >
                            {tr(`ratings.${e.rating}`)}
                          </span>
                        </div>
                        <div className="mt-1 font-medium">{e.purpose}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {e.requesterName} · {e.departmentName} ·{" "}
                          {t("submittedAt", { date: format(e.submittedAt, "d MMM yyyy HH:mm") })}
                        </div>
                      </div>
                      <Link
                        href={`/admin/${e.bookingId}`}
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
                        {t("vehicle")}: {e.vehicleReg ?? "—"}
                      </span>
                      <span>
                        {t("driver")}: {e.driverName || "—"}
                      </span>
                      <span>{t("destination")}: {e.destination}, {e.province}</span>
                      <span>
                        {t("tripDate")}: {format(e.startAt, "d MMM yyyy")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}
