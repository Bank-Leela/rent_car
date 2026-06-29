"use client";

import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { ListSearch } from "@/components/list-search";
import { EmptyState } from "@/components/empty-state";
import {
  RequesterBookingList,
  type RequesterBookingCard,
} from "@/components/requester-booking-list";

export function RequesterHistoryClient({
  bookings,
}: {
  bookings: RequesterBookingCard[];
}) {
  const t = useTranslations("listSearch");
  return (
    <ListSearch
      items={bookings}
      keys={["destination", "purpose", "jobNumber"]}
      render={(rows) =>
        rows.length === 0 ? (
          <EmptyState icon={FileText} title={t("noMatches")} />
        ) : (
          <RequesterBookingList bookings={rows} />
        )
      }
    />
  );
}
