"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select-field";
import {
  matchBookingAction,
  setOnCallShiftAction,
  escalateToKhunTopAction,
} from "@/lib/booking/matching-actions";

export function MatchingButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations("matching");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [escalating, startEscalate] = useTransition();
  const [escalated, setEscalated] = useState(false);

  return (
    <div className="space-y-3">
      <form
        action={(formData) => {
          setError(null);
          formData.set("bookingId", bookingId);
          startTransition(async () => {
            const res = await matchBookingAction(formData);
            if (res && !res.ok) setError(res.error);
          });
        }}
        className="space-y-2"
      >
        <Button type="submit" disabled={pending}>
          {pending ? t("running") : t("runMatch")}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </form>

      {error && !escalated && (
        <form
          action={(formData) => {
            formData.set("bookingId", bookingId);
            startEscalate(async () => {
              const res = await escalateToKhunTopAction(formData);
              if (res && res.ok) setEscalated(true);
            });
          }}
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-900/40 dark:bg-amber-950/40"
        >
          <p className="mb-2 text-amber-900 dark:text-amber-200">
            {t("escalationHint")}
          </p>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={escalating}
          >
            {escalating ? t("escalating") : t("escalateToKhunTop")}
          </Button>
        </form>
      )}

      {escalated && (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
          {t("escalatedConfirmation")}
        </p>
      )}
    </div>
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
  const t = useTranslations("matching");
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
          <SelectField
            id="onCallDriverId"
            name="driverId"
            defaultValue={defaultDriverId ?? ""}
            className="h-9 w-52"
            options={[
              { value: "", label: t("autoRotate") },
              ...drivers.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        </div>
        <Button type="submit" disabled={pending} size="sm">
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
