"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { changeDepartmentAction } from "@/lib/auth/credentials-actions";

export function ChangeDepartmentForm({
  departments,
  currentDepartmentId,
}: {
  departments: { id: string; nameEn: string; nameTh: string }[];
  currentDepartmentId: string | null;
}) {
  const t = useTranslations("account");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const res = await changeDepartmentAction(formData);
          if (res && !res.ok) setError(res.error);
          else {
            setSaved(true);
            router.refresh();
          }
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="departmentId">{t("departmentLabel")}</Label>
        <SearchableSelect
          id="departmentId"
          name="departmentId"
          required
          defaultValue={currentDepartmentId ?? ""}
          placeholder={t("departmentPlaceholder")}
          searchPlaceholder={t("departmentSearchPlaceholder")}
          emptyText={t("departmentEmpty")}
          ariaLabel={t("departmentLabel")}
          options={departments.map((d) => ({
            value: d.id,
            label: d.nameTh,
          }))}
        />
        <p className="text-xs text-muted-foreground">{t("departmentHelper")}</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("departmentSaved")}</p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
