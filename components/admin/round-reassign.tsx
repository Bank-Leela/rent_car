"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, X } from "lucide-react";
import { reassignVehicleAction, unassignBookingAction } from "@/lib/booking/schedule-actions";
import { useFormAction } from "@/components/forms/use-form-action";

export interface ReassignTarget {
  /** The destination driver's own car — car=driver, so picking the driver picks the car. */
  vehicleId: string;
  driverId: string;
  driverName: string | null;
  registrationNumber: string | null;
}

// Manual override for one round on the admin board. The rounds board replaced
// the drag-drop timeline, so this is how P'Top moves a single trip without
// re-running the whole batch: pick another driver (= their car), or send the
// trip back to the queue. Both post to the SAME server actions the old board
// used — the overlap / driver-elsewhere guards still apply and a rejected move
// surfaces its conflict message.
export function RoundReassign({
  bookingId,
  targets,
}: {
  bookingId: string;
  targets: ReassignTarget[];
}) {
  const router = useRouter();
  const t = useTranslations("scheduler");
  const [open, setOpen] = useState(false);
  const refresh = () => {
    setOpen(false);
    router.refresh();
  };
  const move = useFormAction(reassignVehicleAction, { bookingId, onSuccess: refresh });
  const drop = useFormAction(unassignBookingAction, { bookingId, onSuccess: refresh });

  const err = move.error ?? drop.error;
  const message = err
    ? t(err === "vehicleBusy" ? "dropConflict" : err === "noAssignedDriver" ? "noAssignedDriver" : "dropFailed")
    : null;
  const busy = move.pending || drop.pending;

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("moveRound")}
        className="grid h-6 w-6 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-20 w-56 rounded-lg border bg-popover p-1 shadow-lg">
          <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{t("moveRoundTo")}</p>
          <ul className="max-h-64 overflow-y-auto">
            {targets.map((tg) => (
              <li key={tg.vehicleId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("vehicleId", tg.vehicleId);
                    move.run(fd);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                >
                  <span className="truncate">{tg.driverName ?? "—"}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{tg.registrationNumber}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => drop.run(new FormData())}
            className="mt-1 flex w-full items-center gap-1.5 rounded border-t px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <X className="h-3 w-3" aria-hidden />
            {t("unassignRound")}
          </button>
          {message && <p className="px-2 py-1 text-[11px] text-destructive">{message}</p>}
        </div>
      )}
    </span>
  );
}
