"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { resolveReclaimAction } from "@/lib/booking/batch-actions";

export function ReclaimDecisionForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations("adminBatch");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(decision: "RECLAIM_WERN" | "OUTSOURCE") {
    setError(null);
    const fd = new FormData();
    fd.set("bookingId", bookingId);
    fd.set("decision", decision);
    startTransition(async () => {
      const res = await resolveReclaimAction(fd);
      if (res && !res.ok) setError(res.error);
      else router.refresh();
    });
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
