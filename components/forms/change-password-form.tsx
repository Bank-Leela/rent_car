"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "@/lib/auth/credentials-actions";

export function ChangePasswordForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const t = useTranslations("account");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const currentRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autoFocus) currentRef.current?.focus();
  }, [autoFocus]);

  return (
    <form
      action={(formData) => {
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const res = await changePasswordAction(formData);
          if (res && !res.ok) setError(res.error);
          else {
            setSaved(true);
            // After a successful change the proxy's forceChange gate is
            // gone — refresh to clear the banner + unlock the rest of the
            // app.
            router.refresh();
          }
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="currentPassword">{t("currentPassword")}</Label>
        <PasswordInput
          ref={currentRef}
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="newPassword">{t("newPassword")}</Label>
        <PasswordInput id="newPassword" name="newPassword" autoComplete="new-password" required minLength={8} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
        <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required minLength={8} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("passwordSaved")}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("changePassword")}
      </Button>
    </form>
  );
}
