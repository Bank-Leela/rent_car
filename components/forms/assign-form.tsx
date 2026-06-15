"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { assignBookingAction, denyBookingAction } from "@/lib/booking/actions";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";

type Option = { id: string; label: string; sublabel?: string; disabled?: boolean; conflict?: boolean };

// CR-02: admin only allocates the vehicle. Drivers self-claim their roles on
// the driver schedule board.
export function AssignForm({
  bookingId,
  vehicleOptions,
}: {
  bookingId: string;
  vehicleOptions: Option[];
}) {
  const t = useTranslations("assignForm");
  const { error, pending, run } = useFormAction(assignBookingAction, { bookingId });

  return (
    <form action={run} className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="vehicleId">{t("vehicle")}</Label>
        <select
          id="vehicleId"
          name="vehicleId"
          required
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{t("select")}</option>
          {vehicleOptions.map((v) => (
            <option key={v.id} value={v.id} disabled={v.disabled}>
              {v.label}
              {v.conflict ? t("conflictSuffix") : ""}
              {v.sublabel ? ` (${v.sublabel})` : ""}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">{t("driversSelfClaim")}</p>

      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? t("assigning") : t("assign")}
      </Button>
    </form>
  );
}

export function DenyForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("assignForm");
  const { error, pending, run } = useFormAction(denyBookingAction, { bookingId });
  return (
    <form action={run} className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="reason">{t("reason")}</Label>
        <Textarea id="reason" name="reason" rows={2} required />
      </div>
      <FormError message={error} />
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? t("denying") : t("denyBooking")}
      </Button>
    </form>
  );
}
