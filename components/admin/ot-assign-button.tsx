"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { approveBookingAction, approveDocumentAction } from "@/lib/booking/approval-actions";
import { reassignVehicleAction } from "@/lib/booking/schedule-actions";

// One-click act on a waitlist card's overtime recommendation: approve the
// WAITLIST booking, then place it on the recommended car (its driver comes
// with the car — car=driver). Both steps are the existing single-booking
// actions, so every guard (status, overlap pre-check, DB no-double-book
// backstop) applies. If placement fails the booking stays APPROVED in the
// assignment queue and the error is shown.
export function OtAssignButton({
  bookingId,
  vehicleId,
  summary,
}: {
  bookingId: string;
  vehicleId: string;
  summary: string;
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    if (!window.confirm(t("otAssignConfirm", { summary }))) return;
    setError(null);
    start(async () => {
      const approveFd = new FormData();
      approveFd.set("bookingId", bookingId);
      const approved = await approveBookingAction(approveFd);
      if (!approved.ok) {
        setError(approved.error);
        return;
      }
      // approveBookingAction lands on AWAITING_DOCUMENT, not APPROVED — the
      // paperwork step was added to the pipeline after this button was written.
      // reassignVehicleAction only dispatches from DISPATCHABLE_STATUSES, so the
      // second half of this "one click" always failed and the button was dead:
      // it approved the trip and then reported that it could not place it.
      const docFd = new FormData();
      docFd.set("bookingId", bookingId);
      const documented = await approveDocumentAction(docFd);
      if (!documented.ok) {
        setError(documented.error);
        return;
      }

      const assignFd = new FormData();
      assignFd.set("bookingId", bookingId);
      assignFd.set("vehicleId", vehicleId);
      const assigned = await reassignVehicleAction(assignFd);
      if (assigned.ok) {
        toast.success(t("otAssigned", { summary }));
      } else {
        // Approved but not placed — it's in the APPROVED queue now.
        setError(t("otAssignPlaceFailed"));
      }
      router.refresh();
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex h-7 items-center gap-1 rounded-md bg-amber-600 px-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
      >
        <Zap className="h-3.5 w-3.5" aria-hidden />
        {pending ? t("otAssigning") : t("otAssign")}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
