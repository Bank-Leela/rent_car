"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { uploadSignatureAction, setDelegateAction } from "@/lib/booking/approval-actions";

export function SignatureForm({ hasSignature }: { hasSignature: boolean }) {
  const t = useTranslations("signatureForm");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const res = await uploadSignatureAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-2">
        <Label htmlFor="signature">{t("imageLabel")}</Label>
        <Input
          id="signature"
          name="signature"
          type="file"
          accept="image/png,image/jpeg"
          required
        />
        <p className="text-xs text-muted-foreground">
          {hasSignature ? t("helperReplace") : t("helperUpload")}
        </p>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("uploading") : hasSignature ? t("replaceSignature") : t("uploadSignature")}
      </Button>
    </form>
  );
}

export function DelegateForm({ currentDelegateEmail }: { currentDelegateEmail: string | null }) {
  const t = useTranslations("delegateForm");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const res = await setDelegateAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-2">
        <Label htmlFor="delegateEmail">{t("emailLabel")}</Label>
        <Input
          id="delegateEmail"
          name="delegateEmail"
          type="email"
          placeholder={t("emailPlaceholder")}
          defaultValue={currentDelegateEmail ?? ""}
        />
        <p className="text-xs text-muted-foreground">{t("helper")}</p>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending} variant="outline">
        {pending ? t("saving") : t("saveDelegation")}
      </Button>
    </form>
  );
}
