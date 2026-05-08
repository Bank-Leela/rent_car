"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { uploadSignatureAction, setDelegateAction } from "@/lib/booking/approval-actions";

export function SignatureForm({ hasSignature }: { hasSignature: boolean }) {
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
      encType="multipart/form-data"
    >
      <div className="grid gap-2">
        <Label htmlFor="signature">Signature image (PNG or JPEG, ≤1 MB)</Label>
        <Input
          id="signature"
          name="signature"
          type="file"
          accept="image/png,image/jpeg"
          required
        />
        <p className="text-xs text-muted-foreground">
          {hasSignature ? "Uploading replaces your stored signature." : "Once uploaded, this image will be embedded in the PDF for every booking you approve."}
        </p>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : hasSignature ? "Replace signature" : "Upload signature"}
      </Button>
    </form>
  );
}

export function DelegateForm({ currentDelegateEmail }: { currentDelegateEmail: string | null }) {
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
        <Label htmlFor="delegateEmail">Delegate email (leave blank to clear)</Label>
        <Input
          id="delegateEmail"
          name="delegateEmail"
          type="email"
          placeholder="staff@chula.ac.th"
          defaultValue={currentDelegateEmail ?? ""}
        />
        <p className="text-xs text-muted-foreground">
          The delegate will see your pending approvals and can sign on your behalf using their account.
        </p>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending} variant="outline">
        {pending ? "Saving…" : "Save delegation"}
      </Button>
    </form>
  );
}
