"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Undo2 } from "lucide-react";
import { toggleLessSubmittedAction } from "@/lib/booking/less-actions";

// Manual LESS-submission tracker: the admin downloads the form, uploads it to
// LESS himself, then marks it here so the queue shows what's already gone.
export function LessSubmitToggle({ bookingId, submittedLabel }: { bookingId: string; submittedLabel: string | null }) {
  const t = useTranslations("less");
  const router = useRouter();
  const [pending, start] = useTransition();

  const toggle = (submitted: boolean) => {
    start(async () => {
      const fd = new FormData();
      fd.set("bookingId", bookingId);
      fd.set("submitted", String(submitted));
      const res = await toggleLessSubmittedAction(fd);
      if (res.ok) {
        toast.success(submitted ? t("marked") : t("unmarked"));
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  if (submittedLabel) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          {t("submittedOn", { date: submittedLabel })}
        </span>
        <button
          type="button"
          onClick={() => toggle(false)}
          disabled={pending}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
        >
          <Undo2 className="h-3 w-3" aria-hidden />
          {t("undo")}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => toggle(true)}
      disabled={pending}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      {pending ? t("marking") : t("markSubmitted")}
    </button>
  );
}
