"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminResetPasswordAction,
  adminToggleActiveAction,
} from "@/lib/auth/credentials-actions";

interface AdminUserRowData {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  thaiName: string | null;
  department: string | null;
  roles: string[];
  isActive: boolean;
  mustChangePassword: boolean;
}

export function UserRow({ user }: { user: AdminUserRowData }) {
  const t = useTranslations("adminUsers");
  const [resetVisible, setResetVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <li className="py-3 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium">{user.name ?? user.email}</div>
          <div className="text-xs text-muted-foreground space-x-2">
            <span className="font-mono">{user.email}</span>
            <span>·</span>
            <span className="font-mono">{user.username ?? "—"}</span>
            {user.department && (<><span>·</span><span>{user.department}</span></>)}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {user.roles.map((r) => (
              <span
                key={r}
                className="rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wide"
              >
                {r}
              </span>
            ))}
            {!user.isActive && (
              <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-destructive">
                {t("inactiveBadge")}
              </span>
            )}
            {user.mustChangePassword && (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
                {t("mustChangeBadge")}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setResetVisible((v) => !v)}
          >
            {resetVisible ? t("cancel") : t("resetPassword")}
          </Button>
          <form
            action={(formData) => {
              setError(null);
              formData.set("userId", user.id);
              startTransition(async () => {
                const res = await adminToggleActiveAction(formData);
                if (res && !res.ok) setError(res.error);
              });
            }}
          >
            <Button type="submit" variant="outline" size="sm" disabled={pending}>
              {user.isActive ? t("disable") : t("enable")}
            </Button>
          </form>
        </div>
      </div>

      {resetVisible && (
        <form
          action={(formData) => {
            setError(null);
            formData.set("userId", user.id);
            startTransition(async () => {
              const res = await adminResetPasswordAction(formData);
              if (res && !res.ok) setError(res.error);
              else setResetVisible(false);
            });
          }}
          className="flex items-end gap-2"
        >
          <div className="grid gap-1 flex-1 min-w-0">
            <label className="text-xs" htmlFor={`reset-${user.id}`}>{t("newInitialPassword")}</label>
            <Input
              id={`reset-${user.id}`}
              name="initialPassword"
              type="text"
              required
              minLength={8}
              autoComplete="off"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </form>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  );
}
