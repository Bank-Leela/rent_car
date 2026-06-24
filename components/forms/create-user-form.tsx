"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select-field";
import { adminCreateUserAction } from "@/lib/auth/credentials-actions";

const ROLES = ["REQUESTER", "APPROVER", "ADMIN", "DRIVER"] as const;

export function CreateUserForm({
  departments,
}: {
  departments: Array<{ id: string; nameEn: string; nameTh: string }>;
}) {
  const t = useTranslations("adminUsers");
  const [pickedRoles, setPickedRoles] = useState<string[]>(["REQUESTER"]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        setSaved(false);
        formData.set("roles", pickedRoles.join(","));
        startTransition(async () => {
          const res = await adminCreateUserAction(formData);
          if (res && !res.ok) setError(res.error);
          else {
            setSaved(true);
            (document.getElementById("create-user-form") as HTMLFormElement | null)?.reset();
            setPickedRoles(["REQUESTER"]);
          }
        });
      }}
      id="create-user-form"
      className="grid sm:grid-cols-2 gap-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" required autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="username">{t("username")}</Label>
        <Input id="username" name="username" required minLength={3} maxLength={40} autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" required autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="thaiName">{t("thaiName")}</Label>
        <Input id="thaiName" name="thaiName" autoComplete="off" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="departmentId">{t("department")}</Label>
        <SelectField
          id="departmentId"
          name="departmentId"
          defaultValue=""
          className="h-10"
          options={[
            { value: "", label: t("noDepartment") },
            ...departments.map((d) => ({ value: d.id, label: d.nameEn })),
          ]}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="initialPassword">{t("initialPassword")}</Label>
        <Input id="initialPassword" name="initialPassword" type="text" required minLength={8} autoComplete="off" />
        <p className="text-xs text-muted-foreground">{t("initialPasswordNote")}</p>
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label>{t("roles")}</Label>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => {
            const active = pickedRoles.includes(r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setPickedRoles((cur) =>
                    cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r],
                  )
                }
                className={`inline-flex h-9 items-center rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                }`}
              >
                {t(`role.${r}`)}
              </button>
            );
          })}
        </div>
      </div>
      {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
      {saved && !error && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400 sm:col-span-2">{t("created")}</p>
      )}
      <Button type="submit" disabled={pending} className="sm:col-span-2 w-full sm:w-auto">
        {pending ? t("creating") : t("create")}
      </Button>
    </form>
  );
}
