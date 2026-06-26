"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { reassignVehicleAction } from "@/lib/booking/schedule-actions";
import { useFormAction } from "@/components/forms/use-form-action";

// One-click "assign to the recommended car". Posts bookingId + vehicleId to the
// existing reassignVehicleAction (which assigns the car + its driver, and allows
// overlap only for the duty car — the reclaim case).
export function AssignRecoButton({
  bookingId,
  vehicleId,
  secondaryDriverId,
  label,
}: {
  bookingId: string;
  vehicleId: string;
  secondaryDriverId?: string | null;
  label: string;
}) {
  const router = useRouter();
  const t = useTranslations("scheduler");
  const { error, pending, run } = useFormAction(reassignVehicleAction, {
    bookingId,
    onSuccess: () => router.refresh(),
  });
  // Map the action's machine code to a translated message (same scheme as the board).
  const message = error
    ? t(error === "vehicleBusy" ? "dropConflict" : error === "noAssignedDriver" ? "noAssignedDriver" : "dropFailed")
    : null;
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          const fd = new FormData();
          fd.set("vehicleId", vehicleId);
          if (secondaryDriverId) fd.set("secondaryDriverId", secondaryDriverId);
          run(fd);
        }}
      >
        {pending ? "…" : label}
      </Button>
      {message && <span className="text-xs text-destructive">{message}</span>}
    </span>
  );
}
