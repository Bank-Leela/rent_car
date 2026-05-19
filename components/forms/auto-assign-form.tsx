"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  autoAssignBookingAction,
  setOnCallShiftAction,
} from "@/lib/booking/auto-assign-actions";

export function AutoAssignButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations("autoAssign");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await autoAssignBookingAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-2"
    >
      <Button type="submit" disabled={pending}>
        {pending ? t("running") : t("runAutoAssign")}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">{t("description")}</p>
    </form>
  );
}

export function OnCallShiftForm({
  date,
  defaultDriverId,
  drivers,
}: {
  date: string;
  defaultDriverId: string | null;
  drivers: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("autoAssign");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("date", date);
        startTransition(async () => {
          const res = await setOnCallShiftAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="onCallDriverId" className="text-xs">
            {t("onCallLabel", { date })}
          </Label>
          <select
            id="onCallDriverId"
            name="driverId"
            defaultValue={defaultDriverId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{t("autoRotate")}</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending} size="sm">
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
