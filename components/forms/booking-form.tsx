"use client";

import { useState, useTransition } from "react";
import { addDays, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BANGKOK_PROVINCE,
  LEAD_TIME_BANGKOK_DAYS,
  LEAD_TIME_OUTSIDE_DAYS,
} from "@/lib/booking/rules";
import { THAI_PROVINCES } from "@/lib/booking/provinces";
import { createBookingAction } from "@/lib/booking/actions";

const datetimeLocalValue = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

export function BookingForm() {
  const now = new Date();
  const [province, setProvince] = useState<string>(BANGKOK_PROVINCE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const requiredDays =
    province === BANGKOK_PROVINCE ? LEAD_TIME_BANGKOK_DAYS : LEAD_TIME_OUTSIDE_DAYS;
  const earliestStart = addDays(now, requiredDays);
  const minStart = datetimeLocalValue(earliestStart);

  return (
    <Card>
      <CardHeader>
        <CardTitle>New booking</CardTitle>
        <CardDescription>
          Lead time: <strong>{requiredDays} days</strong> for{" "}
          {province === BANGKOK_PROVINCE ? "Bangkok" : "out-of-province"} trips.
          Earliest you can start: <strong>{format(earliestStart, "EEE d MMM yyyy")}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const res = await createBookingAction(formData);
              if (res && !res.ok) setError(res.error);
            });
          }}
          className="space-y-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="purpose">Purpose</Label>
            <Input id="purpose" name="purpose" required />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="destination">Destination</Label>
              <Input id="destination" name="destination" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="province">Province</Label>
              <select
                id="province"
                name="province"
                required
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={province}
                onChange={(e) => setProvince(e.target.value)}
              >
                {THAI_PROVINCES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="startAt">Start (departure)</Label>
              <Input id="startAt" name="startAt" type="datetime-local" min={minStart} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="endAt">End (back at faculty)</Label>
              <Input id="endAt" name="endAt" type="datetime-local" min={minStart} required />
              <p className="text-xs text-muted-foreground">
                Enter the time you expect to be <strong>back at the faculty</strong>, not the time you leave the destination.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="passengerCount">Passenger count</Label>
              <Input
                id="passengerCount"
                name="passengerCount"
                type="number"
                min={1}
                max={60}
                required
                defaultValue={1}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="estimatedDistance">Estimated distance (km, optional)</Label>
              <Input
                id="estimatedDistance"
                name="estimatedDistance"
                type="number"
                min={0}
                placeholder="e.g. 250"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="passengerNotes">Passenger notes (optional)</Label>
            <Textarea id="passengerNotes" name="passengerNotes" rows={3} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="needsOutsourcing" value="true" />
            Flag this trip as potentially needing outsourcing
          </label>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? "Submitting…" : "Submit booking"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
