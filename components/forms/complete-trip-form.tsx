"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { completeTripAction } from "@/lib/booking/extra-actions";

export function CompleteTripForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("completeTripForm");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await completeTripAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-3"
    >
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="grid gap-1">
          <Label htmlFor="startMileage" className="text-xs">{t("startMileage")}</Label>
          <Input id="startMileage" name="startMileage" type="number" min={0} placeholder="0" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="endMileage" className="text-xs">{t("endMileage")}</Label>
          <Input id="endMileage" name="endMileage" type="number" min={0} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="distanceKm" className="text-xs">{t("distanceKm")}</Label>
          <Input id="distanceKm" name="distanceKm" type="number" min={0} placeholder={t("distanceAuto")} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="driverNotes" className="text-xs">{t("driverNotes")}</Label>
        <Textarea id="driverNotes" name="driverNotes" rows={2} />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
