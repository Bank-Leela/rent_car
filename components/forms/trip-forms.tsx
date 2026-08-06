"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { endTripAction } from "@/lib/booking/driver-actions";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";

export function EndTripForm({
  bookingId,
  startMileage,
  onSuccess,
}: {
  bookingId: string;
  // Already recorded (trip was started earlier) → the field is not asked for
  // again and the success toast can show the distance. Null → the driver enters
  // both readings here, which is the normal case: they fill the whole trip in
  // one go when they get back, off the same log sheet.
  startMileage?: number | null;
  onSuccess?: () => void;
}) {
  const t = useTranslations("tripForms");
  const needsStart = startMileage == null;
  // Values from the submitted FormData, kept so the success toast can echo back
  // exactly what was recorded — the drawer refetches and the form vanishes, so
  // without this a network hiccup leaves the driver guessing.
  const lastSubmit = useRef<{ end?: number; fuel?: string; toll?: string }>({});
  const { error, pending, run } = useFormAction(endTripAction, {
    bookingId,
    onSuccess: () => {
      const { end, fuel, toll } = lastSubmit.current;
      const parts: string[] = [];
      if (end != null && startMileage != null && end >= startMileage) {
        parts.push(t("toastKm", { km: end - startMileage }));
      }
      if (fuel) parts.push(t("toastFuel", { amount: fuel }));
      if (toll) parts.push(t("toastToll", { amount: toll }));
      toast.success(parts.length ? t("tripEndedToast", { details: parts.join(" · ") }) : t("tripEndedToastPlain"));
      onSuccess?.();
    },
  });
  const runWithCapture = (fd: FormData) => {
    lastSubmit.current = {
      end: Number(fd.get("endMileage")) || undefined,
      fuel: String(fd.get("fuelCost") ?? "") || undefined,
      toll: String(fd.get("tollwayCost") ?? "") || undefined,
    };
    return run(fd);
  };
  return (
    <form action={runWithCapture} className="space-y-4">
      <div className={needsStart ? "grid gap-4 sm:grid-cols-2" : "grid gap-2"}>
        {needsStart && (
          <div className="grid gap-2">
            <Label htmlFor="startMileage" className="text-base">{t("startingKm")}</Label>
            <Input
              id="startMileage"
              name="startMileage"
              type="number"
              inputMode="numeric"
              required
              className="h-14 text-lg"
              placeholder={t("startingPlaceholder")}
            />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="endMileage" className="text-base">{t("endingKm")}</Label>
          <Input
            id="endMileage"
            name="endMileage"
            type="number"
            inputMode="numeric"
            required
            className="h-14 text-lg"
          />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="fuelType" className="text-base">{t("fuelType")}</Label>
          <Input id="fuelType" name="fuelType" type="text" className="h-12 text-base" placeholder={t("fuelTypePlaceholder")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="fuelLiters" className="text-base">{t("fuelLiters")}</Label>
          <Input id="fuelLiters" name="fuelLiters" type="number" step="0.01" inputMode="decimal" className="h-12 text-base" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="fuelCost" className="text-base">{t("fuelCost")}</Label>
          <Input id="fuelCost" name="fuelCost" type="number" step="0.01" inputMode="decimal" className="h-12 text-base" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="tollwayCost" className="text-base">{t("tollwayCost")}</Label>
          <Input id="tollwayCost" name="tollwayCost" type="number" step="0.01" inputMode="decimal" className="h-12 text-base" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="parkingCost" className="text-base">{t("parkingCost")}</Label>
          <Input id="parkingCost" name="parkingCost" type="number" step="0.01" inputMode="decimal" className="h-12 text-base" />
        </div>
      </div>
      <label className="flex items-center gap-3 text-base">
        <input type="checkbox" name="usedExpressway" value="true" className="h-5 w-5" />
        {t("usedExpressway")}
      </label>
      <div className="grid gap-2">
        <Label htmlFor="driverNotes" className="text-base">{t("notesOptional")}</Label>
        <Textarea id="driverNotes" name="driverNotes" rows={2} />
      </div>
      <FormError message={error} size="base" />
      <Button type="submit" disabled={pending} className="w-full h-14 text-lg">
        {pending ? t("ending") : t("endTrip")}
      </Button>
    </form>
  );
}
