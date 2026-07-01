"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Self-contained field widgets used by BookingForm, split out to keep the form
// component focused. Each is stateless-or-locally-stateful and props-driven.

export function ReqLabel({
  htmlFor,
  children,
  className,
}: {
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Label htmlFor={htmlFor} className={className}>
      {children}
      <span aria-hidden className="ml-0.5 text-destructive">*</span>
      <span className="sr-only"> (required)</span>
    </Label>
  );
}

const WEEKDAYS = [
  { value: 1, key: "mon" },
  { value: 2, key: "tue" },
  { value: 3, key: "wed" },
  { value: 4, key: "thu" },
  { value: 5, key: "fri" },
  { value: 6, key: "sat" },
  { value: 0, key: "sun" },
] as const;

export function RecurrenceWeekdays() {
  const t = useTranslations("bookingForm.weekdays");
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
              aria-pressed={active}
              className={`inline-flex min-h-10 min-w-12 items-center justify-center rounded-md border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted"
              }`}
            >
              {t(d.key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Passenger count: typeable number field flanked by −/+ buttons. Controlled by
 * the parent so applying a template can set it. Keeps `name="passengerCount"`
 * so the form action reads it from FormData. Native spinners are suppressed;
 * the −/+ buttons are the 44px touch targets.
 */
export function PassengerStepper({
  value,
  onChange,
  min = 1,
  max = 60,
}: {
  value: string;
  onChange: (next: string) => void;
  min?: number;
  max?: number;
}) {
  const t = useTranslations("bookingForm");
  const num = parseInt(value, 10);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const nudge = (delta: number) =>
    onChange(String(clamp((Number.isNaN(num) ? min : num) + delta)));

  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        aria-label={t("passengerDecrement")}
        onClick={() => nudge(-1)}
        disabled={!Number.isNaN(num) && num <= min}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-lg leading-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
      >
        −
      </button>
      <Input
        id="passengerCount"
        name="passengerCount"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onChange(String(Number.isNaN(num) ? min : clamp(num)))}
        className="h-10 text-center text-base tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label={t("passengerIncrement")}
        onClick={() => nudge(1)}
        disabled={!Number.isNaN(num) && num >= max}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-lg leading-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
