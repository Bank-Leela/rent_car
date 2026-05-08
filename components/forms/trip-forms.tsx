"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { startTripAction, endTripAction } from "@/lib/booking/driver-actions";

export function StartTripForm({ bookingId }: { bookingId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await startTripAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-4"
    >
      <div className="grid gap-2">
        <Label htmlFor="startMileage" className="text-base">Starting kilometres</Label>
        <Input
          id="startMileage"
          name="startMileage"
          type="number"
          inputMode="numeric"
          required
          className="h-14 text-lg"
          placeholder="e.g. 12500"
        />
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-base text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending} className="w-full h-14 text-lg">
        {pending ? "Starting…" : "Start trip"}
      </Button>
    </form>
  );
}

export function EndTripForm({ bookingId }: { bookingId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) => {
        setError(null);
        formData.set("bookingId", bookingId);
        startTransition(async () => {
          const res = await endTripAction(formData);
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-4"
    >
      <div className="grid gap-2">
        <Label htmlFor="endMileage" className="text-base">Ending kilometres</Label>
        <Input
          id="endMileage"
          name="endMileage"
          type="number"
          inputMode="numeric"
          required
          className="h-14 text-lg"
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="fuelCost" className="text-base">Fuel cost (THB)</Label>
          <Input id="fuelCost" name="fuelCost" type="number" step="0.01" inputMode="decimal" className="h-12 text-base" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="tollwayCost" className="text-base">Tollway cost (THB)</Label>
          <Input id="tollwayCost" name="tollwayCost" type="number" step="0.01" inputMode="decimal" className="h-12 text-base" />
        </div>
      </div>
      <label className="flex items-center gap-3 text-base">
        <input type="checkbox" name="usedExpressway" value="true" className="h-5 w-5" />
        Used expressway
      </label>
      <div className="grid gap-2">
        <Label htmlFor="driverNotes" className="text-base">Notes (optional)</Label>
        <Textarea id="driverNotes" name="driverNotes" rows={2} />
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-base text-destructive">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending} className="w-full h-14 text-lg">
        {pending ? "Ending…" : "End trip"}
      </Button>
    </form>
  );
}
