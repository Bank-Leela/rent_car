"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  claimBookingAction,
  releaseClaimAction,
  confirmScheduleAction,
} from "@/lib/booking/driver-actions";
import { useFormAction } from "@/components/forms/use-form-action";

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
  const { error, pending, run } = useFormAction(claimBookingAction, { bookingId });
  const label = role === "PRIMARY" ? t("claimPrimary") : t("claimSecondary");
  return (
    <form
      action={(formData) => {
        formData.set("role", role);
        run(formData);
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
  const { error, pending, run } = useFormAction(releaseClaimAction, { bookingId });
  return (
    <form action={run} className="space-y-2">
      <Button type="submit" disabled={pending} variant="ghost">
        {pending ? t("releasing") : t("release")}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

export function ConfirmScheduleButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations("claimForm");
  const { error, pending, run } = useFormAction(confirmScheduleAction, { bookingId });
  return (
    <form action={run} className="space-y-2">
      <Button type="submit" disabled={pending}>
        {pending ? t("confirming") : t("confirmSchedule")}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
