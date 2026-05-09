"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveBookingAction, denyByApproverAction } from "@/lib/booking/approval-actions";

export function ApproveForm({ bookingId, hasSignature }: { bookingId: string; hasSignature: boolean }) {
  const t = useTranslations("approverActions");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await approveBookingAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-2">
        <Label htmlFor="comment">{t("commentOptional")}</Label>
        <Textarea id="comment" name="comment" rows={2} />
      </div>
      {!hasSignature && (
        <p className="text-xs text-muted-foreground">{t("noSignatureWarning")}</p>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("approving") : t("approve")}
      </Button>
    </form>
  );
}

export function ApproverDenyForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("approverActions");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await denyByApproverAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-2">
        <Label htmlFor="comment">{t("reason")}</Label>
        <Textarea id="comment" name="comment" rows={2} required />
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? t("denying") : t("deny")}
      </Button>
    </form>
  );
}
