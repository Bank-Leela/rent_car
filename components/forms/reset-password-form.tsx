"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordWithTokenAction } from "@/lib/auth/credentials-actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("reset");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
          {t("doneNote")}
        </div>
        <Link
          href="/"
          className="block w-full rounded-md bg-primary py-2 text-center text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t("backToSignIn")}
        </Link>
      </div>
    );
  }
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("token", token);
        startTransition(async () => {
          const res = await resetPasswordWithTokenAction(formData);
          if (res && !res.ok) setError(res.error);
          else setDone(true);
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="newPassword">{t("newPassword")}</Label>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={8} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
