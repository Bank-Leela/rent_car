"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { declineAssignmentAction } from "@/lib/booking/driver-actions";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";

// "I can't do this trip." Expands to a required reason before firing — declining
// sends the trip back to the admin queue, so it's deliberate, not one-tap.
export function DeclineForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("tripForms");
  const tt = useTranslations("toast");
  const [open, setOpen] = useState(false);
  const { error, pending, run } = useFormAction(declineAssignmentAction, {
    bookingId,
    onSuccess: () => toast.success(tt("declined")),
    onError: (err) => toast.error(err ?? tt("genericError")),
  });

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("declineTrip")}
      </Button>
    );
  }

  return (
    <form action={run} className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="decline-reason">{t("declineReason")}</Label>
        <Textarea
          id="decline-reason"
          name="reason"
          rows={2}
          required
          placeholder={t("declineReasonPlaceholder")}
        />
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? t("declining") : t("confirmDecline")}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          {t("declineCancel")}
        </Button>
      </div>
    </form>
  );
}
