"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction } from "@/lib/auth/credentials-actions";

export function SignInForm() {
  const t = useTranslations("login");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const res = await signInAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="identifier">{t("identifier")}</Label>
        <Input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          required
          placeholder={t("identifierPlaceholder")}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t("signingIn") : t("signIn")}
      </Button>
    </form>
  );
}
