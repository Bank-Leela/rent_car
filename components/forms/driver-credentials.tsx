"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { adminSetDriverUsernameAction } from "@/lib/admin/driver-actions";
import { adminResetPasswordAction } from "@/lib/auth/credentials-actions";
import { useActionToast } from "@/components/hooks/use-action-toast";

export function DriverCredentials({
  driverId,
  userId,
  username,
}: {
  driverId: string;
  userId: string;
  username: string | null;
}) {
  const t = useTranslations("adminDrivers");
  const te = useTranslations("errors");
  const { toastResult } = useActionToast();
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {/* Username — admin can change it freely (the once-limit is self-service only). */}
      <form
        action={(fd) => {
          fd.set("driverId", driverId);
          startTransition(async () => {
            const res = await adminSetDriverUsernameAction(fd);
            toastResult(res.ok ? res : { ok: false, error: te(res.error) }, { success: t("usernameSaved") });
          });
        }}
        className="space-y-2"
      >
        <Label htmlFor="username">{t("username")}</Label>
        <Input
          id="username"
          name="username"
          defaultValue={username ?? ""}
          minLength={3}
          maxLength={40}
          required
          autoComplete="off"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("saving") : t("saveUsername")}
        </Button>
      </form>

      {/* Password reset — reuses the shared admin action; sets mustChangePassword. */}
      <form
        action={(fd) => {
          fd.set("userId", userId);
          startTransition(async () => {
            const res = await adminResetPasswordAction(fd);
            toastResult(
              res && !res.ok ? { ok: false, error: te(res.error) } : { ok: true },
              { success: t("passwordReset") },
            );
          });
        }}
        className="space-y-2"
      >
        <Label htmlFor="initialPassword">{t("newInitialPassword")}</Label>
        <PasswordInput
          id="initialPassword"
          name="initialPassword"
          minLength={8}
          required
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{t("passwordResetNote")}</p>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? t("saving") : t("resetPassword")}
        </Button>
      </form>
    </div>
  );
}
