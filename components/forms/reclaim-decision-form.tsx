"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { resolveReclaimAction } from "@/lib/booking/batch-actions";
import { useFormAction } from "@/components/forms/use-form-action";

export function ReclaimDecisionForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("adminBatch");
  const router = useRouter();
  const { error, pending, run } = useFormAction(resolveReclaimAction, {
    bookingId,
    onSuccess: () => router.refresh(),
  });

  function submit(decision: "RECLAIM_WERN" | "OUTSOURCE") {
    const fd = new FormData();
    fd.set("decision", decision);
    run(fd);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs">{t("reclaimPrompt")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => submit("RECLAIM_WERN")}
        >
          {t("reclaimWern")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => submit("OUTSOURCE")}
        >
          {t("outsourceInstead")}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
