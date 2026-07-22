"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { adminUpdateDriverAction } from "@/lib/admin/driver-actions";
import { useActionToast } from "@/components/hooks/use-action-toast";

interface CustomField {
  label: string;
  value: string;
}

interface FormDriver {
  id: string;
  name: string;
  thaiName: string;
  phone: string;
  nickname: string;
  licenseType: string;
  licenseNumber: string;
  licenseExpiresAt: string;
  position: string;
  retirementYear: string;
  notes: string;
  isActive: boolean;
  vehicleId: string;
  customFields: CustomField[];
}

export function DriverEditForm({
  driver,
  vehicleOptions,
}: {
  driver: FormDriver;
  vehicleOptions: { value: string; label: string }[];
}) {
  const t = useTranslations("adminDrivers");
  const te = useTranslations("errors");
  const { toastResult } = useActionToast();
  const [isActive, setIsActive] = useState(driver.isActive);
  const [customFields, setCustomFields] = useState<CustomField[]>(driver.customFields);
  const [pending, startTransition] = useTransition();

  const updateField = (i: number, patch: Partial<CustomField>) =>
    setCustomFields((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addField = () => setCustomFields((rows) => [...rows, { label: "", value: "" }]);
  const removeField = (i: number) => setCustomFields((rows) => rows.filter((_, idx) => idx !== i));

  return (
    <form
      action={(fd) => {
        fd.set("driverId", driver.id);
        fd.set("isActive", isActive ? "true" : "false");
        // Serialize the dynamic rows; the action drops blank-label rows.
        fd.set("customFields", JSON.stringify(customFields.filter((r) => r.label.trim() !== "")));
        startTransition(async () => {
          const res = await adminUpdateDriverAction(fd);
          toastResult(res.ok ? res : { ok: false, error: te(res.error) }, { success: t("saved") });
        });
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <Field id="name" label={t("name")} required defaultValue={driver.name} />
      <Field id="thaiName" label={t("thaiName")} defaultValue={driver.thaiName} />
      <Field id="nickname" label={t("nickname")} defaultValue={driver.nickname} />
      <Field id="phone" label={t("phone")} defaultValue={driver.phone} />
      <Field id="licenseType" label={t("licenseType")} defaultValue={driver.licenseType} />
      <Field id="licenseNumber" label={t("licenseNumber")} defaultValue={driver.licenseNumber} />

      <div className="grid gap-1.5">
        <Label htmlFor="licenseExpiresAt">{t("licenseExpiresAt")}</Label>
        <Input id="licenseExpiresAt" name="licenseExpiresAt" type="date" defaultValue={driver.licenseExpiresAt} />
      </div>
      <Field id="position" label={t("position")} defaultValue={driver.position} />

      <div className="grid gap-1.5">
        <Label htmlFor="retirementYear">{t("retirementYear")}</Label>
        <Input
          id="retirementYear"
          name="retirementYear"
          type="number"
          inputMode="numeric"
          min={2400}
          max={2700}
          defaultValue={driver.retirementYear}
          placeholder={t("retirementYearPlaceholder")}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="vehicleId">{t("assignedVehicle")}</Label>
        <SearchableSelect
          id="vehicleId"
          name="vehicleId"
          defaultValue={driver.vehicleId}
          options={vehicleOptions}
          placeholder={t("noVehicle")}
          searchPlaceholder={t("vehicleSearchPlaceholder")}
          ariaLabel={t("assignedVehicle")}
        />
      </div>

      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={driver.notes} />
      </div>

      <div className="grid gap-2 sm:col-span-2">
        <Label>{t("customFieldsTitle")}</Label>
        {customFields.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("customFieldsEmpty")}</p>
        ) : (
          <div className="grid gap-2">
            {customFields.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={t("customFieldLabel")}
                  placeholder={t("customFieldLabel")}
                  value={row.label}
                  onChange={(e) => updateField(i, { label: e.target.value })}
                  className="sm:max-w-[38%]"
                  autoComplete="off"
                />
                <Input
                  aria-label={t("customFieldValue")}
                  placeholder={t("customFieldValue")}
                  value={row.value}
                  onChange={(e) => updateField(i, { value: e.target.value })}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => removeField(i)}
                  aria-label={t("customFieldRemove")}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md border text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
        <Button type="button" variant="outline" size="sm" onClick={addField} className="w-fit">
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          {t("customFieldAdd")}
        </Button>
      </div>

      <div className="grid gap-1.5 sm:col-span-2">
        <Label>{t("active")}</Label>
        <button
          type="button"
          aria-pressed={isActive}
          onClick={() => setIsActive((v) => !v)}
          className={`inline-flex h-9 w-fit items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            isActive ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
          }`}
        >
          {isActive ? t("activeYes") : t("activeNo")}
        </button>
      </div>

      <Button type="submit" disabled={pending} className="w-full sm:col-span-2 sm:w-auto">
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  defaultValue,
  required,
}: {
  id: string;
  label: string;
  defaultValue: string;
  required?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} required={required} defaultValue={defaultValue} autoComplete="off" />
    </div>
  );
}
