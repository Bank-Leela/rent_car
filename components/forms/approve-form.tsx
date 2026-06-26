"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveBookingAction, denyByApproverAction } from "@/lib/booking/approval-actions";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";
import { DenyPresetChips } from "@/components/forms/deny-preset-chips";

export function ApproveForm({ bookingId, hasSignature }: { bookingId: string; hasSignature: boolean }) {
  const t = useTranslations("approverActions");
  const { error, pending, run } = useFormAction(approveBookingAction, { bookingId });
  return (
    <form action={run} className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="comment">{t("commentOptional")}</Label>
        <Textarea id="comment" name="comment" rows={2} />
      </div>
      {!hasSignature && (
        <p className="text-xs text-muted-foreground">{t("noSignatureWarning")}</p>
      )}
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? t("approving") : t("approve")}
      </Button>
    </form>
  );
}

export function ApproverDenyForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("approverActions");
  const { error, pending, run } = useFormAction(denyByApproverAction, { bookingId });
  const [reason, setReason] = useState("");
  return (
    <form action={run} className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="comment">{t("reason")}</Label>
        <DenyPresetChips onPick={setReason} />
        <Textarea
          id="comment"
          name="comment"
          rows={2}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <FormError message={error} />
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? t("denying") : t("deny")}
      </Button>
    </form>
  );
}
