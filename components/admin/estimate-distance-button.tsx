"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Navigation } from "lucide-react";
import { estimateDistanceAction } from "@/lib/booking/distance-actions";

const ERROR_KEYS = new Set(["mapsNotConfigured", "mapsLookupFailed", "mapsNoRoute"]);

// "Estimate from Google Maps" — fills estimatedDistance so P'Top can see the
// distance before approving. Rendered only when the key is configured.
export function EstimateDistanceButton({ bookingId, hasDistance }: { bookingId: string; hasDistance: boolean }) {
  const t = useTranslations("maps");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("bookingId", bookingId);
      const res = await estimateDistanceAction(fd);
      if (res.ok) {
        toast.success(t("filled"));
        router.refresh();
      } else {
        setError(ERROR_KEYS.has(res.error) ? t(res.error) : res.error);
      }
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <Navigation className="h-3.5 w-3.5" aria-hidden />
        {pending ? t("estimating") : hasDistance ? t("reestimate") : t("estimate")}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
