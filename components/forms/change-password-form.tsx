"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "@/lib/auth/credentials-actions";

export function ChangePasswordForm() {
  const t = useTranslations("account");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const res = await changePasswordAction(formData);
          if (res && !res.ok) setError(res.error);
          else setSaved(true);
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="currentPassword">{t("currentPassword")}</Label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="newPassword">{t("newPassword")}</Label>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={8} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("passwordSaved")}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("changePassword")}
      </Button>
    </form>
  );
}
