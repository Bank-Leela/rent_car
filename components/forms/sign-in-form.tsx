"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { signInAction } from "@/lib/auth/credentials-actions";

export function SignInForm() {
  const t = useTranslations("login");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [capsLock, setCapsLock] = useState(false);
  const identifierRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    identifierRef.current?.focus();
  }, []);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === "function") {
      setCapsLock(e.getModifierState("CapsLock"));
    }
  }

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
      noValidate
    >
      <div className="grid gap-1.5">
        <Label htmlFor="identifier">{t("identifier")}</Label>
        <Input
          ref={identifierRef}
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder={t("identifierPlaceholder")}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">{t("password")}</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          onKeyUp={handleKey}
          onKeyDown={handleKey}
        />
        {capsLock && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t("capsLockHint")}</p>
        )}
      </div>
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t("signingIn") : t("signIn")}
      </Button>
    </form>
  );
}
