"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelBookingAction } from "@/lib/booking/extra-actions";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";

export function CancelForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("cancelForm");
  const { error, pending, run } = useFormAction(cancelBookingAction, { bookingId });
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("cancelThisBooking")}
      </Button>
    );
  }
  return (
    <form action={run} className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="reason">{t("reason")}</Label>
        <Textarea id="reason" name="reason" rows={2} required />
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? t("cancelling") : t("confirmCancel")}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
          {t("keepBooking")}
        </Button>
      </div>
    </form>
  );
}
