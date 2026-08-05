"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { matchBookingAction, escalateToKhunTopAction } from "@/lib/booking/matching-actions";
import { setNeedsSecondaryDriverAction } from "@/lib/booking/extra-actions";

export function MatchingButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations("matching");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [escalating, startEscalate] = useTransition();
  const [escalated, setEscalated] = useState(false);

  return (
    <div className="space-y-3">
      <form
        action={(formData) => {
          setError(null);
          formData.set("bookingId", bookingId);
          startTransition(async () => {
            const res = await matchBookingAction(formData);
            if (res && !res.ok) setError(res.error);
          });
        }}
        className="space-y-2"
      >
        <Button type="submit" disabled={pending}>
          {pending ? t("running") : t("runMatch")}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </form>

      {error && !escalated && (
        <form
          action={(formData) => {
            formData.set("bookingId", bookingId);
            startEscalate(async () => {
              const res = await escalateToKhunTopAction(formData);
              if (res && res.ok) setEscalated(true);
            });
          }}
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-900/40 dark:bg-amber-950/40"
        >
          <p className="mb-2 text-amber-900 dark:text-amber-200">
            {t("escalationHint")}
          </p>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={escalating}
          >
            {escalating ? t("escalating") : t("escalateToKhunTop")}
          </Button>
        </form>
      )}

      {escalated && (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
          {t("escalatedConfirmation")}
        </p>
      )}
    </div>
  );
}

// Admin decides whether THIS trip needs a secondary driver — replaces the
// old estimatedDistance > 400km auto-check now that distance is no longer
// collected. Typical use case: overnight out-of-province trips.
export function NeedsSecondaryDriverToggle({
  bookingId,
  defaultChecked,
}: {
  bookingId: string;
  defaultChecked: boolean;
}) {
  const t = useTranslations("matching");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        setSaved(false);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await setNeedsSecondaryDriverAction(formData);
          if (res && !res.ok) setError(res.error);
          else setSaved(true);
        });
      }}
      className="space-y-2"
    >
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          name="needsSecondaryDriver"
          value="true"
          defaultChecked={defaultChecked}
          className="mt-1 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span>
          <span className="font-medium">{t("needsSecondaryDriverLabel")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("needsSecondaryDriverHelper")}
          </span>
        </span>
      </label>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? t("saving") : t("save")}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {saved && !error && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          {t("needsSecondaryDriverSaved")}
        </p>
      )}
    </form>
  );
}
