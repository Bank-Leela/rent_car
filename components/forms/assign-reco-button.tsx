"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { reassignVehicleAction } from "@/lib/booking/schedule-actions";
import { useFormAction } from "@/components/forms/use-form-action";

// One-click "assign to the recommended car". Posts bookingId + vehicleId to the
// existing reassignVehicleAction (which assigns the car + its driver, and allows
// overlap only for the duty car — the reclaim case).
export function AssignRecoButton({
  bookingId,
  vehicleId,
  label,
}: {
  bookingId: string;
  vehicleId: string;
  label: string;
}) {
  const router = useRouter();
  const { error, pending, run } = useFormAction(reassignVehicleAction, {
    bookingId,
    onSuccess: () => router.refresh(),
  });
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
          run(fd);
        }}
      >
        {pending ? "…" : label}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
