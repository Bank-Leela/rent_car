"use client";

import { useState, useTransition } from "react";
import { addDays, format, startOfDay } from "date-fns";
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

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

function RecurrenceWeekdays() {
  const [picked, setPicked] = useState<number[]>([]);
  return (
    <div className="space-y-2">
      <input type="hidden" name="recurringWeekdays" value={picked.join(",")} />
      <div className="flex flex-wrap gap-1">
        {WEEKDAYS.map((d) => {
          const active = picked.includes(d.value);
          return (
            <button
              key={d.value}
              type="button"
              onClick={() =>
                setPicked((cur) =>
                  cur.includes(d.value) ? cur.filter((v) => v !== d.value) : [...cur, d.value],
                )
              }
              className={`rounded-md border px-3 py-1 text-sm ${
                active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              }`}
            >
              {d.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BookingForm() {
  const now = new Date();
  const [province, setProvince] = useState<string>(BANGKOK_PROVINCE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const requiredDays =
    province === BANGKOK_PROVINCE ? LEAD_TIME_BANGKOK_DAYS : LEAD_TIME_OUTSIDE_DAYS;
  // Earliest is midnight on (today + requiredDays); any time on that day is fine.
  const earliestStart = startOfDay(addDays(now, requiredDays));
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

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">Make this recurring (optional)</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Select the weekdays that should also generate bookings, and the date the recurrence ends. The first occurrence above stays as-is; one child booking is created per matching weekday up to the end date.
              </p>
              <RecurrenceWeekdays />
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="recurringUntil">Repeat until</Label>
                  <Input id="recurringUntil" name="recurringUntil" type="date" />
                </div>
              </div>
            </div>
          </details>

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
