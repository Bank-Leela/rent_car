"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField } from "@/components/ui/select-field";
import { adminCreateUserAction } from "@/lib/auth/credentials-actions";

const ROLES = ["REQUESTER", "ADMIN", "DRIVER"] as const;

export function CreateUserForm({
  departments,
}: {
  departments: Array<{ id: string; nameEn: string; nameTh: string }>;
}) {
  const t = useTranslations("adminUsers");
  // One role per account. The schema models roles as a many-to-many
  // (UserRole[] with @@unique([userId, role])) so it CAN hold several, and one
  // comment in lib/auth/station.ts anticipates an ADMIN+DRIVER account — but no
  // seeded or live user has ever had more than one, and multi-select let an
  // account be built that no screen is designed for. Kept as an array so the
  // wire format and the server action are unchanged, and so re-enabling
  // multi-select later is a one-line change here rather than a migration.
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
      // A taller neighbour (the password field carries a helper line) stretches
      // the whole grid row; without `content-start` the shorter field's auto rows
      // absorb the slack and its label/input drift out of line with the column
      // beside it.
      className="grid sm:grid-cols-2 gap-3 [&>div]:content-start"
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
            ...departments.map((d) => ({ value: d.id, label: d.nameTh })),
          ]}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="initialPassword">{t("initialPassword")}</Label>
        <Input id="initialPassword" name="initialPassword" type="text" required minLength={8} autoComplete="off" />
        <p className="text-xs text-muted-foreground">{t("initialPasswordNote")}</p>
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label id="role-label">{t("roles")}</Label>
        <div role="radiogroup" aria-labelledby="role-label" className="flex flex-wrap gap-2">
          {ROLES.map((r) => {
            const active = pickedRoles.includes(r);
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={active}
                // Radio semantics: picking one replaces the selection rather
                // than adding to it. Never clears to empty — an account with no
                // role can sign in and see nothing.
                onClick={() => setPickedRoles([r])}
                // 44px pill, matching the queue filter chips — these were h-9
                // (36px) and rounded-md, so the app had two different shapes for
                // "a small toggle you press".
                className={`inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
      {/* justify-self-start is the fix, not sm:w-auto — this is a GRID cell, and
          grid items stretch to fill by default, so `w-auto` could never shrink it.
          The result was a page-wide primary button that read as a banner.
          size="xl" is the contract's primary action: a 48px pill. */}
      <Button
        type="submit"
        size="xl"
        disabled={pending}
        className="w-full sm:col-span-2 sm:w-auto sm:justify-self-start"
      >
        {pending ? t("creating") : t("create")}
      </Button>
    </form>
  );
}
