import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Star } from "lucide-react";

import { getLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StarRatingDisplay } from "@/components/ui/star-rating";
import { formatTh } from "@/lib/format-date";

export default async function DriverReviews({ params }: { params: Promise<{ driverId: string }> }) {
  await requireRole("ADMIN");
  const { driverId } = await params;
  const t = await getTranslations("adminEvaluations");
  const locale = await getLocale();
  const isThai = locale.toLowerCase().startsWith("th");
  const nameOf = (u: { name: string | null; thaiName: string | null }) =>
    (isThai ? u.thaiName ?? u.name : u.name ?? u.thaiName) ?? "—";

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, user: { select: { name: true, thaiName: true } } },
  });
  if (!driver) notFound();

  const reviews = await prisma.evaluation.findMany({
    where: { trip: { booking: { primaryDriverId: driverId } } },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
      rating: true,
      comment: true,
      submittedAt: true,
      trip: { select: { booking: { select: { jobNumber: true, destination: true } } } },
    },
  });
  const count = reviews.length;
  const avg = count ? reviews.reduce((a, r) => a + r.rating, 0) / count : 0;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/evaluations"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t("back")}
      </Link>
      <PageHeader
        title={nameOf(driver.user)}
        description={count ? `${avg.toFixed(1)} ★ · ${t("reviewCount", { count })}` : t("noReviews")}
      />

      {count === 0 ? (
        <EmptyState icon={Star} title={t("noReviews")} />
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <StarRatingDisplay value={r.rating} />
                <span className="text-xs text-muted-foreground">{formatTh(r.submittedAt, "d MMM yyyy")}</span>
              </div>
              {r.comment && <p className="mt-2 whitespace-pre-wrap text-sm">{r.comment}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                {r.trip.booking.destination}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
