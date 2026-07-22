"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { VehicleType } from "@prisma/client";
import { SelectField } from "@/components/ui/select-field";
import { createVehicleAction } from "@/lib/booking/fleet-actions";

const VEHICLE_TYPES = Object.values(VehicleType);

export type FleetDriverOption = { id: string; name: string };

// "Add a car to the system" (Admin เพิ่มรถในระบบได้). A driver can be paired
// right away; leave unpaired and set it later from the fleet table below.
export function AddVehicleForm({ drivers }: { drivers: FleetDriverOption[] }) {
  const t = useTranslations("fleet");
  const te = useTranslations("errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reg, setReg] = useState("");
  const [type, setType] = useState<VehicleType>(VehicleType.SEDAN);
  const [capacity, setCapacity] = useState("4");
  const [notes, setNotes] = useState("");
  const [driverId, setDriverId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    if (!reg.trim()) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("registrationNumber", reg.trim());
      fd.set("type", type);
      fd.set("capacity", capacity);
      fd.set("notes", notes);
      fd.set("driverId", driverId);
      const res = await createVehicleAction(fd);
      if (res.ok) {
        toast.success(t("vehicleAdded", { reg: reg.trim() }));
        setReg("");
        setType(VehicleType.SEDAN);
        setCapacity("4");
        setNotes("");
        setDriverId("");
        setOpen(false);
        router.refresh();
      } else {
        // action returns i18n keys under errors.*
        setError(res.error === "vehicleRegTaken" ? te("vehicleRegTaken") : te("invalidInput"));
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-4 w-4" aria-hidden />
        {t("addVehicle")}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3 shadow-sm">
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t("car")}
        <input
          value={reg}
          onChange={(e) => setReg(e.target.value)}
          placeholder="กข-1234"
          className="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t("type")}
        <SelectField
          value={type}
          onValueChange={(v) => setType(v as VehicleType)}
          className="h-9 w-32"
          options={VEHICLE_TYPES.map((vt) => ({ value: vt, label: t(`type_${vt}`) }))}
        />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t("capacity")}
        <input
          type="number"
          min={1}
          max={60}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          className="h-9 w-20 rounded-md border border-input bg-background px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t("driver")}
        <SelectField
          value={driverId}
          onValueChange={setDriverId}
          className="h-9 w-40"
          options={[{ value: "", label: t("unpaired") }, ...drivers.map((d) => ({ value: d.id, label: d.name }))]}
        />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t("notes")}
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !reg.trim()}
        className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? t("adding") : t("add")}
      </button>
      <button type="button" onClick={() => { setOpen(false); setError(null); }} className="inline-flex h-9 items-center rounded-md px-2 text-sm text-muted-foreground hover:underline">
        {t("cancel")}
      </button>
      {error && <span className="w-full text-xs text-destructive">{error}</span>}
    </div>
  );
}
