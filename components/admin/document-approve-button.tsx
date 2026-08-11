"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approveDocumentAction, approveDocumentSeriesAction } from "@/lib/booking/approval-actions";

// "เอกสารเรียบร้อย" — the signed official form is back.
//
// This is the step that runs จัด: approving decides the trip may happen, this
// decides the paperwork is complete, and only then does the booking get a car.
// ADMIN only, because the transport office is who holds the signed form.
export function DocumentApproveButton({
  bookingId,
  seriesParentId,
  label,
  pendingLabel,
}: {
  bookingId: string;
  /** Set for a recurring series: confirms the paperwork for every occurrence at
   *  once, because one form covers the whole series. */
  seriesParentId?: string;
  label: string;
  pendingLabel: string;
}) {
  const router = useRouter();
  const ta = useTranslations("approverActions");
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          if (seriesParentId) {
            fd.set("parentId", seriesParentId);
            const res = await approveDocumentSeriesAction(fd);
            // Confirming the document runs จัด, and จัด can fail to place a day.
            // The result was being discarded, so a 24-day series reported a clean
            // success while some of those days quietly had no car. Name them.
            const stuck = res.blocked ?? [];
            if (stuck.length > 0) {
              toast.warning(ta("seriesBlockedTitle", { count: stuck.length }), {
                description: stuck.map((x) => `${x.date} — ${x.reason}`).join("\n"),
                duration: 12000,
              });
            }
          } else {
            fd.set("bookingId", bookingId);
            await approveDocumentAction(fd);
          }
          router.refresh();
        })
      }
    >
      <FileCheck className="h-4 w-4" aria-hidden />
      {pending ? pendingLabel : label}
    </Button>
  );
}
