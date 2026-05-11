"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordOutsourcingAction } from "@/lib/booking/extra-actions";

export function OutsourceForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("outsourceForm");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await recordOutsourcingAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-3"
    >
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
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="notify" value="true" defaultChecked />
        {t("emailRequester")}
      </label>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("markOutsourced")}
      </Button>
    </form>
  );
}
