"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileInput } from "@/components/ui/file-input";
import { Label } from "@/components/ui/label";
import { recordOutsourcingAction } from "@/lib/booking/extra-actions";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";

export function OutsourceForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("outsourceForm");
  const { error, pending, run } = useFormAction(recordOutsourcingAction, { bookingId });
  return (
    <form action={run} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="outsourceVendor">{t("vendor")}</Label>
          <Input id="outsourceVendor" name="outsourceVendor" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="outsourceCost">{t("cost")}</Label>
          <Input id="outsourceCost" name="outsourceCost" type="number" step="0.01" required />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="outsourceReference">{t("reference")}</Label>
        <Input id="outsourceReference" name="outsourceReference" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="quote">{t("quoteFile")}</Label>
        <FileInput id="quote" name="quote" accept="application/pdf,image/png,image/jpeg" />
        <p className="text-xs text-muted-foreground">{t("quoteHint")}</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="notify" value="true" defaultChecked />
        {t("emailRequester")}
      </label>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("markOutsourced")}
      </Button>
    </form>
  );
}
