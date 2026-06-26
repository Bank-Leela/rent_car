"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveBookingAction, denyByApproverAction } from "@/lib/booking/approval-actions";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";
import { DenyPresetChips } from "@/components/forms/deny-preset-chips";

// Inline approve/deny for one pending booking on the console queue, so the
// approver clears the queue without opening each detail page. Approve is one
// tap; deny expands in place (canned chips + editable reason). The server
// actions enforce the real permission (canApprove) and status guards — these
// buttons render only for approvers, and Deny only on PENDING_APPROVAL
// (denyByApproverAction rejects WAITLIST), so `canDeny` mirrors that.
export function ApproverQueueActions({
  bookingId,
  canDeny,
}: {
  bookingId: string;
  canDeny: boolean;
}) {
  const t = useTranslations("approverActions");
  const router = useRouter();
  const [denyOpen, setDenyOpen] = useState(false);
  const [reason, setReason] = useState("");

  const approve = useFormAction(approveBookingAction, {
    bookingId,
    onSuccess: () => router.refresh(),
  });
  const deny = useFormAction(denyByApproverAction, {
    bookingId,
    onSuccess: () => {
      setDenyOpen(false);
      setReason("");
      router.refresh();
    },
  });

  if (denyOpen) {
    return (
      <div className="mt-3 space-y-2 border-t pt-3">
        <DenyPresetChips onPick={setReason} />
        <Textarea
          aria-label={t("reason")}
          placeholder={t("reason")}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <FormError message={deny.error} />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={deny.pending || reason.trim().length < 3}
            onClick={() => {
              const fd = new FormData();
              fd.set("comment", reason);
              deny.run(fd);
            }}
          >
            {deny.pending ? t("denying") : t("deny")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={deny.pending}
            onClick={() => {
              setDenyOpen(false);
              setReason("");
            }}
          >
            {t("cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
      <Button
        type="button"
        disabled={approve.pending}
        onClick={() => approve.run(new FormData())}
      >
        <Check className="h-4 w-4" />
        {approve.pending ? t("approving") : t("approve")}
      </Button>
      {canDeny && (
        <Button
          type="button"
          variant="destructive"
          disabled={approve.pending}
          onClick={() => setDenyOpen(true)}
        >
          <X className="h-4 w-4" />
          {t("deny")}
        </Button>
      )}
      <FormError message={approve.error} />
    </div>
  );
}
