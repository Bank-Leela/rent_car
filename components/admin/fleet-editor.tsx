"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Car, Trash2 } from "lucide-react";
import { VehicleType } from "@prisma/client";
import { SelectField } from "@/components/ui/select-field";
import { ListSearch } from "@/components/list-search";
import { EmptyState } from "@/components/empty-state";
import { AddVehicleForm } from "@/components/admin/add-vehicle-form";
import { setVehicleDriverAction, updateVehicleSpecAction, removeVehicleAction } from "@/lib/booking/fleet-actions";

export type FleetCar = {
  id: string;
  registrationNumber: string;
  assignedDriverId: string | null;
  type: VehicleType;
  capacity: number;
  // Flattened for client-side search; mirrors the assigned driver's label.
  driverName: string;
};
export type FleetDriver = { id: string; name: string };

const VEHICLE_TYPES = Object.values(VehicleType);

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

  // Physical spec edits (type / seats). Type saves on pick; capacity saves on
  // blur so typing "12" doesn't fire per keystroke.
  function saveSpec(car: FleetCar, next: { type?: VehicleType; capacity?: number }) {
    const type = next.type ?? car.type;
    const capacity = next.capacity ?? car.capacity;
    if (type === car.type && capacity === car.capacity) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("vehicleId", car.id);
      fd.set("type", type);
      fd.set("capacity", String(capacity));
      await updateVehicleSpecAction(fd);
      router.refresh();
    });
  }

  return (
    // "เพิ่มรถ" lives with the table it appends to, not in the page header: the
    // leave calendar sits between the two, so a button up there is off-screen by
    // the time you are reading the car list and looking for how to add one.
    <div className="max-w-3xl space-y-3">
      <ListSearch
        items={cars}
        keys={["registrationNumber", "driverName"]}
        render={(rows) =>
        rows.length === 0 ? (
          <EmptyState icon={Car} title={ts("noMatches")} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">{t("car")}</th>
                <th className="py-2 font-medium">{t("type")}</th>
                <th className="py-2 font-medium">{t("capacity")}</th>
                <th className="py-2 font-medium">{t("driver")}</th>
                <th className="py-2 font-medium sr-only">{t("remove")}</th>
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
                  <td className="py-2 pr-3">
                    <SelectField
                      disabled={pending}
                      value={c.type}
                      onValueChange={(v) => saveSpec(c, { type: v as VehicleType })}
                      aria-label={`${c.registrationNumber} ${t("type")}`}
                      className="h-9 w-32"
                      options={VEHICLE_TYPES.map((vt) => ({ value: vt, label: t(`type_${vt}`) }))}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      min={1}
                      max={60}
                      defaultValue={c.capacity}
                      disabled={pending}
                      aria-label={`${c.registrationNumber} ${t("capacity")}`}
                      onBlur={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (Number.isFinite(v) && v >= 1 && v <= 60) saveSpec(c, { capacity: v });
                        else e.target.value = String(c.capacity);
                      }}
                      className="h-9 w-20 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
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
                  <td className="py-2 text-right">
                    <RemoveVehicleButton id={c.id} registrationNumber={c.registrationNumber} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
        }
      />
      {/* Outside the ListSearch render so a filtered-to-nothing list still
          offers it — "no matches" is exactly when you want to add the car. */}
      <AddVehicleForm drivers={drivers} />
    </div>
  );
}

// Two-step remove so a car is never dropped on a single stray click.
function RemoveVehicleButton({ id, registrationNumber }: { id: string; registrationNumber: string }) {
  const t = useTranslations("fleet");
  const te = useTranslations("errors");
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    const fd = new FormData();
    fd.set("vehicleId", id);
    startTransition(async () => {
      const res = await removeVehicleAction(fd);
      if (res.ok) {
        toast.success(t("vehicleRemoved"));
        setConfirm(false);
        router.refresh();
      } else {
        toast.error(te(res.error));
      }
    });
  }

  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        aria-label={t("removeVehicleAria", { reg: registrationNumber })}
        className="grid h-9 w-9 place-items-center rounded-md border text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="inline-flex h-9 items-center rounded-md border border-destructive/40 bg-destructive/10 px-2 text-xs font-medium text-destructive hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {pending ? "…" : t("confirmRemove")}
      </button>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        disabled={pending}
        className="inline-flex h-9 items-center rounded-md border px-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("cancel")}
      </button>
    </span>
  );
}
