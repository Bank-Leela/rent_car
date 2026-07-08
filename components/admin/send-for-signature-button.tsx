"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PenLine } from "lucide-react";
import { sendForSignatureAction } from "@/lib/booking/adobe-sign-actions";

const ERROR_KEYS = new Set([
  "adobeNotConfigured",
  "adobeBadStatus",
  "adobeAlreadySent",
  "adobeNoSigner",
  "adobeSendFailed",
]);

// "Send for signature" — fills the official form and creates an Adobe Sign
// agreement for the department head. Admin-only; rendered only when configured.
export function SendForSignatureButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations("adobeSign");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("bookingId", bookingId);
      const res = await sendForSignatureAction(fd);
      if (res.ok) {
        toast.success(t("sent"));
        router.refresh();
      } else {
        setError(ERROR_KEYS.has(res.error) ? t(res.error) : res.error);
      }
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={send}
        disabled={pending}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PenLine className="h-4 w-4" aria-hidden />
        {pending ? t("sending") : t("send")}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
