"use client";

import { useRef, useState, useTransition } from "react";
import { addDays, addYears, format, startOfDay } from "date-fns";
import { useTranslations } from "next-intl";
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
  { value: 1, key: "mon" },
  { value: 2, key: "tue" },
  { value: 3, key: "wed" },
  { value: 4, key: "thu" },
  { value: 5, key: "fri" },
  { value: 6, key: "sat" },
  { value: 0, key: "sun" },
] as const;

function RecurrenceWeekdays() {
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

export function BookingForm() {
  const t = useTranslations("bookingForm");
  const now = new Date();
  const [province, setProvince] = useState<string>(BANGKOK_PROVINCE);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const requiredDays =
    province === BANGKOK_PROVINCE ? LEAD_TIME_BANGKOK_DAYS : LEAD_TIME_OUTSIDE_DAYS;
  // Earliest is midnight on (today + requiredDays); any time on that day is fine.
  const earliestStart = startOfDay(addDays(now, requiredDays));
  const minStart = datetimeLocalValue(earliestStart);
  // Cap typed year so the browser can't accept "20251" or longer.
  const maxStart = datetimeLocalValue(addYears(now, 5));
  const earliestDateLabel = format(earliestStart, "EEE d MMM yyyy");

  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  const fillEarliest = () => {
    const start = new Date(earliestStart);
    start.setHours(8, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 4);
    if (startRef.current) startRef.current.value = datetimeLocalValue(start);
    if (endRef.current) endRef.current.value = datetimeLocalValue(end);
  };

  const richStrong = { strong: (chunks: React.ReactNode) => <strong>{chunks}</strong> };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {t.rich(province === BANGKOK_PROVINCE ? "leadTimeBangkok" : "leadTimeOutside", {
            ...richStrong,
            days: requiredDays,
          })}{" "}
          {t.rich("earliestSentence", { ...richStrong, date: earliestDateLabel })}
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
          <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("ajarnSectionTitle")}</legend>
            <p className="-mt-1 text-xs text-muted-foreground">{t("ajarnSectionHelper")}</p>
            <div className="grid gap-2">
              <Label htmlFor="ajarnName">{t("ajarnName")}</Label>
              <Input id="ajarnName" name="ajarnName" required autoComplete="off" />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="ajarnPhone">{t("ajarnPhone")}</Label>
                <Input id="ajarnPhone" name="ajarnPhone" type="tel" required autoComplete="off" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ajarnEmail">{t("ajarnEmail")}</Label>
                <Input id="ajarnEmail" name="ajarnEmail" type="email" required autoComplete="off" />
              </div>
            </div>
          </fieldset>

          <div className="grid gap-2">
            <Label htmlFor="purpose">{t("purpose")}</Label>
            <Input id="purpose" name="purpose" required />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="destination">{t("destination")}</Label>
              <Input id="destination" name="destination" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="province">{t("province")}</Label>
              <select
                id="province"
                name="province"
                required
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="grid gap-2 min-w-0">
                <Label htmlFor="startAt">{t("startLabel")}</Label>
                <Input
                  ref={startRef}
                  id="startAt"
                  name="startAt"
                  type="datetime-local"
                  min={minStart}
                  max={maxStart}
                  required
                  className="w-full min-w-0"
                />
              </div>
              <div className="grid gap-2 min-w-0">
                <Label htmlFor="endAt">{t("endLabel")}</Label>
                <Input
                  ref={endRef}
                  id="endAt"
                  name="endAt"
                  type="datetime-local"
                  min={minStart}
                  max={maxStart}
                  required
                  className="w-full min-w-0"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground pb-1">
              {t.rich("endHelper", richStrong)}
            </p>
            <button
              type="button"
              onClick={fillEarliest}
              className="inline-flex h-9 items-center rounded-md px-2 -mx-2 text-xs font-medium text-primary hover:bg-primary/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("useEarliest", { date: earliestDateLabel })}
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="passengerCount">{t("passengerCount")}</Label>
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
              <Label htmlFor="estimatedDistance">{t("estimatedDistance")}</Label>
              <Input
                id="estimatedDistance"
                name="estimatedDistance"
                type="number"
                min={0}
                placeholder={t("estimatedDistancePlaceholder")}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="passengerNotes">{t("passengerNotes")}</Label>
            <Textarea id="passengerNotes" name="passengerNotes" rows={3} />
          </div>

          <label className="flex min-h-11 items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="needsOutsourcing"
              value="true"
              className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {t("flagOutsourcing")}
          </label>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("recurringSummary")}</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("recurringDescription")}
              </p>
              <RecurrenceWeekdays />
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="recurringUntil">{t("repeatUntil")}</Label>
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
            {pending ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
