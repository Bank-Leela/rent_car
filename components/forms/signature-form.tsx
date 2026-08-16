"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FileInput } from "@/components/ui/file-input";
import { uploadSignatureAction } from "@/lib/booking/approval-actions";
import { useFormAction } from "@/components/forms/use-form-action";
import { FormError } from "@/components/forms/form-error";

export function SignatureForm({
  userId,
  signatureName,
  hasSignature,
}: {
  userId: string;
  signatureName: string | null;
  hasSignature: boolean;
}) {
  const t = useTranslations("signatureForm");
  const { error, pending, run } = useFormAction(uploadSignatureAction);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    hasSignature ? `/api/files/signature/${userId}` : null,
  );

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setPreviewUrl(URL.createObjectURL(file));
  }

  return (
    <form action={run} className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="signatureName">{t("nameLabel")}</Label>
        <Input
          id="signatureName"
          name="signatureName"
          type="text"
          placeholder={t("namePlaceholder")}
          defaultValue={signatureName ?? ""}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="signature">{t("imageLabel")}</Label>
        <FileInput
          id="signature"
          name="signature"
          accept="image/png,image/jpeg"
          required={!hasSignature}
          onChange={onFileChange}
        />
        <p className="text-xs text-muted-foreground">
          {hasSignature ? t("helperReplace") : t("helperUpload")}
        </p>
      </div>
      {previewUrl ? (
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">{t("currentSignature")}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={t("currentSignature")} className="h-16 max-w-xs rounded border bg-white object-contain" />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("noSignatureYet")}</p>
      )}
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : hasSignature ? t("replaceSignature") : t("uploadSignature")}
      </Button>
    </form>
  );
}
