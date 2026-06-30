"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

// Fire a success/error toast from an ActionResult ({ ok, error }). Returns res.ok
// so call sites can branch: `if (toastResult(res, { success: t("saved") })) router.refresh()`.
export function useActionToast() {
  const t = useTranslations("toast");
  function toastResult(res: { ok: boolean; error?: string }, opts: { success: string }) {
    if (res.ok) toast.success(opts.success);
    else toast.error(res.error ?? t("genericError"));
    return res.ok;
  }
  return { toastResult };
}
