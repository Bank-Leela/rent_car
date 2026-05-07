"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TWO_DRIVER_DISTANCE_KM } from "@/lib/booking/rules";
import { assignBookingAction, denyBookingAction } from "@/lib/booking/actions";
import { Textarea } from "@/components/ui/textarea";

type Option = { id: string; label: string; sublabel?: string; disabled?: boolean; conflict?: boolean };

export function AssignForm({
  bookingId,
  estimatedDistance,
  vehicleOptions,
  driverOptions,
}: {
  bookingId: string;
  estimatedDistance: number | null;
  vehicleOptions: Option[];
  driverOptions: Option[];
}) {
  const requiresSecondary =
    typeof estimatedDistance === "number" && estimatedDistance > TWO_DRIVER_DISTANCE_KM;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await assignBookingAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-4"
    >
      <div className="grid gap-2">
        <Label htmlFor="vehicleId">Vehicle</Label>
        <select
          id="vehicleId"
          name="vehicleId"
          required
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Select…</option>
          {vehicleOptions.map((v) => (
            <option key={v.id} value={v.id} disabled={v.disabled}>
              {v.label}
              {v.conflict ? " — conflict (1h buffer)" : ""}
              {v.sublabel ? ` (${v.sublabel})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="primaryDriverId">Primary driver</Label>
          <select
            id="primaryDriverId"
            name="primaryDriverId"
            required
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select…</option>
            {driverOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
                {d.sublabel ? ` (${d.sublabel})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="secondaryDriverId">
            Co-driver {requiresSecondary && <span className="text-destructive">*</span>}
          </Label>
          <select
            id="secondaryDriverId"
            name="secondaryDriverId"
            required={requiresSecondary}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{requiresSecondary ? "Required for >400 km" : "None"}</option>
            {driverOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          {requiresSecondary && (
            <p className="text-xs text-muted-foreground">
              Trip is over {TWO_DRIVER_DISTANCE_KM} km — co-driver required.
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Assigning…" : "Assign"}
      </Button>
    </form>
  );
}

export function DenyForm({ bookingId }: { bookingId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await denyBookingAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-2">
        <Label htmlFor="reason">Reason</Label>
        <Textarea id="reason" name="reason" rows={2} required />
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? "Denying…" : "Deny booking"}
      </Button>
    </form>
  );
}
