import { FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { HISTORY_BOOKING_STATUSES } from "@/components/requester-booking-list";
import { RequesterHistoryClient } from "@/components/requester-history-client";

export default async function RequesterHistory() {
  const session = await requireRole("REQUESTER");
  const t = await getTranslations("requester");
  const bookings = await prisma.booking.findMany({
    where: { requesterId: session.user.id, status: { in: HISTORY_BOOKING_STATUSES } },
    orderBy: { createdAt: "desc" },
    include: { vehicle: true },
  });

  const bookingRows = bookings.map((b) => ({
    id: b.id,
    jobNumber: b.jobNumber,
    status: b.status,
    purpose: b.purpose,
    destination: b.destination,
    province: b.province,
    startAt: b.startAt,
    vehicle: b.vehicle ? { registrationNumber: b.vehicle.registrationNumber } : null,
  }));

  return (
    <div className="space-y-8">
      <PageHeader title={t("historyTitle")} description={t("historyDescription")} />

      {bookingRows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t("historyEmptyTitle")}
          description={t("historyEmptyDescription")}
        />
      ) : (
        <RequesterHistoryClient bookings={bookingRows} />
      )}
    </div>
  );
}
