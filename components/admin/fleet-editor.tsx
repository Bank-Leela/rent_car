"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Car } from "lucide-react";
import { SelectField } from "@/components/ui/select-field";
import { ListSearch } from "@/components/list-search";
import { EmptyState } from "@/components/empty-state";
import { setVehicleDriverAction } from "@/lib/booking/fleet-actions";

export type FleetCar = {
  id: string;
  registrationNumber: string;
  assignedDriverId: string | null;
  // Flattened for client-side search; mirrors the assigned driver's label.
  driverName: string;
};
export type FleetDriver = { id: string; name: string };

export function FleetEditor({ cars, drivers }: { cars: FleetCar[]; drivers: FleetDriver[] }) {
  const t = useTranslations("fleet");
  const ts = useTranslations("listSearch");
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
    <ListSearch
      items={cars}
      keys={["registrationNumber", "driverName"]}
      render={(rows) =>
        rows.length === 0 ? (
          <EmptyState icon={Car} title={ts("noMatches")} />
        ) : (
          <table className="w-full max-w-xl text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">{t("car")}</th>
                <th className="py-2 font-medium">{t("driver")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b last:border-b-0">
                  <td className="py-2">
                    <span className="inline-flex items-center gap-2 font-medium">
                      <Car className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      {c.registrationNumber}
                    </span>
                  </td>
                  <td className="py-2">
                    <SelectField
                      disabled={pending}
                      value={c.assignedDriverId ?? ""}
                      onValueChange={(v) => setDriver(c.id, v)}
                      aria-label={`${c.registrationNumber} ${t("driver")}`}
                      className="h-9"
                      options={[
                        { value: "", label: t("unpaired") },
                        ...drivers.map((d) => ({ value: d.id, label: d.name })),
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    />
  );
}
