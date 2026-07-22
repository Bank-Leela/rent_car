"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveBookingAction, denyByApproverAction } from "@/lib/booking/approval-actions";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";
import { DenyPresetChips } from "@/components/forms/deny-preset-chips";

export function ApproveForm({
  bookingId,
  returnTrip,
  startAt,
}: {
  bookingId: string;
  // One-way ("ไม่เดินทางกลับ") booking → the admin must set the end time before
  // approving. startAt ("yyyy-MM-ddTHH:mm") bounds the picker's minimum.
  returnTrip: boolean;
  startAt: string;
}) {
  const t = useTranslations("approverActions");
  const tt = useTranslations("toast");
  const { error, pending, run } = useFormAction(approveBookingAction, {
    bookingId,
    onSuccess: () => toast.success(tt("bookingApproved")),
    onError: (err) => toast.error(err ?? tt("genericError")),
  });
  return (
    <form action={run} className="space-y-3">
      {!returnTrip && (
        <div className="grid gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-400/40 dark:bg-amber-500/10">
          <Label htmlFor="endAt" className="text-amber-900 dark:text-amber-200">
            {t("setEndTimeLabel")}
            <span aria-hidden className="ml-0.5 text-destructive">*</span>
          </Label>
          <Input id="endAt" name="endAt" type="datetime-local" min={startAt} required />
          <p className="text-xs text-amber-800/80 dark:text-amber-200/70">{t("setEndTimeHelper")}</p>
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="comment">{t("commentOptional")}</Label>
        <Textarea id="comment" name="comment" rows={2} />
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? t("approving") : t("approve")}
      </Button>
    </form>
  );
}

export function ApproverDenyForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("approverActions");
  const tt = useTranslations("toast");
  const { error, pending, run } = useFormAction(denyByApproverAction, {
    bookingId,
    onSuccess: () => toast.success(tt("bookingDenied")),
    onError: (err) => toast.error(err ?? tt("genericError")),
  });
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
