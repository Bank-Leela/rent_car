"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeUsernameAction } from "@/lib/auth/credentials-actions";

export function ChangeUsernameForm({
  currentUsername,
  alreadyChanged,
}: {
  currentUsername: string;
  alreadyChanged: boolean;
}) {
  const t = useTranslations("account");
  const router = useRouter();
  const [value, setValue] = useState<string>(currentUsername);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  if (alreadyChanged) {
    return (
      <div className="space-y-2">
        <Label className="text-xs">{t("usernameLabel")}</Label>
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-mono">{currentUsername}</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {t("usernameLocked")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("usernameLockedHelper")}</p>
      </div>
    );
  }

  return (
    <form
      action={(formData) => {
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const res = await changeUsernameAction(formData);
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
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t("usernameHelper")}</p>
        <p className="text-xs text-amber-600 dark:text-amber-400">{t("usernameOneShotWarning")}</p>
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
