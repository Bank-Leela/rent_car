"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car } from "lucide-react";
import { setVehicleDriverAction } from "@/lib/booking/fleet-actions";

export type FleetCar = { id: string; registrationNumber: string; assignedDriverId: string | null };
export type FleetDriver = { id: string; name: string };

export function FleetEditor({ cars, drivers }: { cars: FleetCar[]; drivers: FleetDriver[] }) {
  const t = useTranslations("fleet");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setDriver(vehicleId: string, driverId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("vehicleId", vehicleId);
      fd.set("driverId", driverId);
      await setVehicleDriverAction(fd);
      router.refresh();
    });
  }

  return (
    <table className="w-full max-w-xl text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-2 font-medium">{t("car")}</th>
          <th className="py-2 font-medium">{t("driver")}</th>
        </tr>
      </thead>
      <tbody>
        {cars.map((c) => (
          <tr key={c.id} className="border-b last:border-b-0">
            <td className="py-2">
              <span className="inline-flex items-center gap-2 font-medium">
                <Car className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {c.registrationNumber}
              </span>
            </td>
            <td className="py-2">
              <select
                disabled={pending}
                value={c.assignedDriverId ?? ""}
                onChange={(e) => setDriver(c.id, e.target.value)}
                aria-label={`${c.registrationNumber} ${t("driver")}`}
                className="h-9 rounded-md border border-input bg-background px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <option value="">{t("unpaired")}</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
