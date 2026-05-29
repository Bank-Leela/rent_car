"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeUsernameAction } from "@/lib/auth/credentials-actions";

export function ChangeUsernameForm({ currentUsername }: { currentUsername: string }) {
  const t = useTranslations("account");
  const [value, setValue] = useState<string>(currentUsername);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const res = await changeUsernameAction(formData);
          if (res && !res.ok) setError(res.error);
          else setSaved(true);
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="username">{t("usernameLabel")}</Label>
        <Input
          id="username"
          name="username"
          required
          minLength={3}
          maxLength={40}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("usernamePlaceholder")}
        />
        <p className="text-xs text-muted-foreground">{t("usernameHelper")}</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">{t("usernameSaved")}</p>
      )}
      <Button type="submit" disabled={pending || value === currentUsername}>
        {pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
