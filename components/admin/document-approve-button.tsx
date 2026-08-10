"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approveDocumentAction } from "@/lib/booking/approval-actions";

// "เอกสารเรียบร้อย" — the signed official form is back.
//
// This is the step that runs จัด: approving decides the trip may happen, this
// decides the paperwork is complete, and only then does the booking get a car.
// ADMIN only, because the transport office is who holds the signed form.
export function DocumentApproveButton({
  bookingId,
  label,
  pendingLabel,
}: {
  bookingId: string;
  label: string;
  pendingLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("bookingId", bookingId);
          await approveDocumentAction(fd);
          router.refresh();
        })
      }
    >
      <FileCheck className="h-4 w-4" aria-hidden />
      {pending ? pendingLabel : label}
    </Button>
  );
}
