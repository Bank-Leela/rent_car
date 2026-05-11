"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TWO_DRIVER_DISTANCE_KM } from "@/lib/booking/rules";
import { assignBookingAction, denyBookingAction } from "@/lib/booking/actions";
import { Textarea } from "@/components/ui/textarea";

type Option = { id: string; label: string; sublabel?: string; disabled?: boolean; conflict?: boolean };

export function AssignForm({
  bookingId,
  estimatedDistance,
  vehicleOptions,
  driverOptions,
}: {
  bookingId: string;
  estimatedDistance: number | null;
  vehicleOptions: Option[];
  driverOptions: Option[];
}) {
  const t = useTranslations("assignForm");
  const requiresSecondary =
    typeof estimatedDistance === "number" && estimatedDistance > TWO_DRIVER_DISTANCE_KM;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await assignBookingAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-4"
    >
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

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="primaryDriverId">{t("primaryDriver")}</Label>
          <select
            id="primaryDriverId"
            name="primaryDriverId"
            required
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{t("select")}</option>
            {driverOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
                {d.sublabel ? ` (${d.sublabel})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="secondaryDriverId">
            {t("coDriver")} {requiresSecondary && <span className="text-destructive">*</span>}
          </Label>
          <select
            id="secondaryDriverId"
            name="secondaryDriverId"
            required={requiresSecondary}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{requiresSecondary ? t("requiredOver400") : t("noneOption")}</option>
            {driverOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          {requiresSecondary && (
            <p className="text-xs text-muted-foreground">
              {t("tripOver400Note", { km: TWO_DRIVER_DISTANCE_KM })}
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("assigning") : t("assign")}
      </Button>
    </form>
  );
}

export function DenyForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("assignForm");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await denyBookingAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-2">
        <Label htmlFor="reason">{t("reason")}</Label>
        <Textarea id="reason" name="reason" rows={2} required />
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? t("denying") : t("denyBooking")}
      </Button>
    </form>
  );
}
