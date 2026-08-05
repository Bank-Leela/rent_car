import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { StarRatingDisplay } from "@/components/ui/star-rating";

export default async function AdminEvaluations() {
  await requireRole("ADMIN");
  const t = await getTranslations("adminEvaluations");
  const locale = await getLocale();
  const isThai = locale.toLowerCase().startsWith("th");
  const nameOf = (u: { name: string | null; thaiName: string | null }) =>
    (isThai ? u.thaiName ?? u.name : u.name ?? u.thaiName) ?? "—";

  const evaluations = await prisma.evaluation.findMany({
    select: { rating: true, trip: { select: { booking: { select: { primaryDriverId: true } } } } },
  });

  // Group ratings by the trip's primary driver.
  const byDriver = new Map<string, number[]>();
  for (const e of evaluations) {
    const did = e.trip.booking.primaryDriverId;
    if (!did) continue;
    const arr = byDriver.get(did) ?? [];
    arr.push(e.rating);
    byDriver.set(did, arr);
  }

  // Active drivers PLUS any inactive/retired driver that still has reviews — so
  // no feedback is hidden from the dashboard.
  const drivers = await prisma.driver.findMany({
    where: { OR: [{ isActive: true }, { id: { in: [...byDriver.keys()] } }] },
    select: { id: true, user: { select: { name: true, thaiName: true } } },
    orderBy: { user: { name: "asc" } },
  });

  const cards = drivers.map((d) => {
    const ratings = byDriver.get(d.id) ?? [];
    const count = ratings.length;
    const avg = count ? ratings.reduce((a, b) => a + b, 0) / count : 0;
    return { id: d.id, name: nameOf(d.user), count, avg };
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.id}
            href={`/admin/evaluations/${c.id}`}
            className="group flex items-center justify-between gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-muted/30"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{c.name}</div>
              {c.count === 0 ? (
                <div className="mt-1 text-xs text-muted-foreground">{t("noReviews")}</div>
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  <StarRatingDisplay value={c.avg} size="sm" />
                  <span className="text-sm font-semibold tabular-nums">{c.avg.toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">{t("reviewCount", { count: c.count })}</span>
                </div>
              )}
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ))}
      </div>
    </div>
  );
}
