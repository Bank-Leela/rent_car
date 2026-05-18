"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  claimBookingAction,
  releaseClaimAction,
  confirmScheduleAction,
} from "@/lib/booking/driver-actions";

export function ClaimButton({
  bookingId,
  role,
  disabled,
}: {
  bookingId: string;
  role: "PRIMARY" | "SECONDARY";
  disabled?: boolean;
}) {
  const t = useTranslations("claimForm");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = role === "PRIMARY" ? t("claimPrimary") : t("claimSecondary");
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        formData.set("role", role);
        startTransition(async () => {
          const res = await claimBookingAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-2"
    >
      <Button type="submit" disabled={pending || disabled} variant={role === "PRIMARY" ? "default" : "outline"}>
        {pending ? t("claiming") : label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

export function ReleaseButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations("claimForm");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await releaseClaimAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-2"
    >
      <Button type="submit" disabled={pending} variant="ghost">
        {pending ? t("releasing") : t("release")}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

export function ConfirmScheduleButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations("claimForm");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await confirmScheduleAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-2"
    >
      <Button type="submit" disabled={pending}>
        {pending ? t("confirming") : t("confirmSchedule")}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
