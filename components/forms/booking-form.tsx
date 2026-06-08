"use client";

import { useState, useTransition } from "react";
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
  WORK_START_HOUR,
  WORK_END_HOUR,
  isWithinWorkHours,
} from "@/lib/booking/rules";
import { THAI_PROVINCES } from "@/lib/booking/provinces";
import { createBookingAction } from "@/lib/booking/actions";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DateTimePicker } from "@/components/ui/date-time-picker";

const datetimeLocalValue = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

function ReqLabel({
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

/**
 * Passenger count: typeable number field flanked by −/+ buttons. Default 1.
 * Keeps `name="passengerCount"` so the form action reads it from FormData.
 * Native spinners are suppressed; the −/+ buttons are the 44px touch targets.
 */
function PassengerStepper({ min = 1, max = 60 }: { min?: number; max?: number }) {
  const t = useTranslations("bookingForm");
  const [value, setValue] = useState<string>(String(min));
  const num = parseInt(value, 10);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const nudge = (delta: number) =>
    setValue(String(clamp((Number.isNaN(num) ? min : num) + delta)));

  return (
    <div className="flex items-stretch gap-2">
      <button
        type="button"
        aria-label={t("passengerDecrement")}
        onClick={() => nudge(-1)}
        disabled={!Number.isNaN(num) && num <= min}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-background text-xl leading-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
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
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setValue(String(Number.isNaN(num) ? min : clamp(num)))}
        className="h-11 text-center text-base tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label={t("passengerIncrement")}
        onClick={() => nudge(1)}
        disabled={!Number.isNaN(num) && num >= max}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-background text-xl leading-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

export type BookingFormDepartment = {
  id: string;
  nameEn: string;
  nameTh: string;
};

export function BookingForm({
  departments,
  defaultDepartmentId,
  locale,
}: {
  departments: BookingFormDepartment[];
  defaultDepartmentId: string | null;
  locale: string;
}) {
  const t = useTranslations("bookingForm");
  const now = new Date();
  const [province, setProvince] = useState<string>(BANGKOK_PROVINCE);
  const isThai = locale.toLowerCase().startsWith("th");
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

  const [startValue, setStartValue] = useState<string>("");
  const [endValue, setEndValue] = useState<string>("");

  const fillEarliest = () => {
    const start = new Date(earliestStart);
    start.setHours(8, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 4);
    setStartValue(datetimeLocalValue(start));
    setEndValue(datetimeLocalValue(end));
  };

  let outOfHours = false;
  // End must be strictly after start. Computed live so we can both warn inline
  // and block submission before the (English-only) server refine fires.
  let endBeforeStart = false;
  if (startValue && endValue) {
    const s = new Date(startValue);
    const e = new Date(endValue);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
      outOfHours = !isWithinWorkHours({ startAt: s, endAt: e });
      endBeforeStart = e.getTime() <= s.getTime();
    }
  }

  // Required-field names + the translation key for each label, used to
  // pre-validate the submission so the user sees an in-form message rather
  // than a browser-native tooltip. outOfHoursReason is conditionally added.
  const baseRequired: Array<{ name: string; labelKey: string }> = [
    { name: "departmentId", labelKey: "department" },
    { name: "ajarnName", labelKey: "ajarnName" },
    { name: "ajarnPhone", labelKey: "ajarnPhone" },
    { name: "ajarnEmail", labelKey: "ajarnEmail" },
    { name: "purpose", labelKey: "purpose" },
    { name: "destination", labelKey: "destination" },
    { name: "province", labelKey: "province" },
    { name: "startAt", labelKey: "startLabel" },
    { name: "endAt", labelKey: "endLabel" },
    { name: "passengerCount", labelKey: "passengerCount" },
  ];

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
          onSubmit={(e) => {
            // Use onSubmit (not the `action` prop) so React 19 does NOT
            // auto-reset the form after the handler runs. With `action`, a
            // validation error would wipe every field the requester typed.
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            setError(null);
            const required = [...baseRequired];
            if (outOfHours) {
              required.push({ name: "outOfHoursReason", labelKey: "outOfHoursReasonLabel" });
            }
            const missing = required.filter((f) => {
              const v = formData.get(f.name);
              return typeof v !== "string" || v.trim() === "";
            });
            if (missing.length > 0) {
              const labels = missing.map((f) => t(f.labelKey)).join(", ");
              setError(t("missingRequiredFields", { labels }));
              const firstId = missing[0]!.name;
              const el = document.getElementById(firstId);
              if (el) (el as HTMLElement).focus();
              return;
            }
            if (endBeforeStart) {
              setError(t("endBeforeStart"));
              document.getElementById("endAt")?.focus();
              return;
            }
            startTransition(async () => {
              const res = await createBookingAction(formData);
              if (res && !res.ok) setError(res.error);
            });
          }}
          className="space-y-4"
        >
          <p className="text-xs text-muted-foreground">
            <span aria-hidden className="text-destructive">*</span>{" "}
            {t("requiredFieldsHint")}
          </p>

          <div className="grid gap-2">
            <ReqLabel htmlFor="departmentId">{t("department")}</ReqLabel>
            <SearchableSelect
              id="departmentId"
              name="departmentId"
              required
              defaultValue={defaultDepartmentId ?? ""}
              placeholder={t("departmentPlaceholder")}
              searchPlaceholder={t("departmentSearchPlaceholder")}
              emptyText={t("departmentEmpty")}
              ariaLabel={t("department")}
              options={departments.map((d) => ({
                value: d.id,
                label: isThai ? d.nameTh : d.nameEn,
              }))}
            />
          </div>

          <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("ajarnSectionTitle")}</legend>
            <p className="-mt-1 text-xs text-muted-foreground">{t("ajarnSectionHelper")}</p>
            <div className="grid gap-2">
              <ReqLabel htmlFor="ajarnName">{t("ajarnName")}</ReqLabel>
              <Input id="ajarnName" name="ajarnName" required autoComplete="off" />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <ReqLabel htmlFor="ajarnPhone">{t("ajarnPhone")}</ReqLabel>
                <Input id="ajarnPhone" name="ajarnPhone" type="tel" required autoComplete="off" />
              </div>
              <div className="grid gap-2">
                <ReqLabel htmlFor="ajarnEmail">{t("ajarnEmail")}</ReqLabel>
                <Input id="ajarnEmail" name="ajarnEmail" type="email" required autoComplete="off" />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("tripSectionTitle")}</legend>
            <p className="-mt-1 text-xs text-muted-foreground">{t("tripSectionHelper")}</p>
            <div className="grid gap-2">
              <ReqLabel htmlFor="purpose">{t("purpose")}</ReqLabel>
              <Input id="purpose" name="purpose" required />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <ReqLabel htmlFor="destination">{t("destination")}</ReqLabel>
                <Input id="destination" name="destination" required />
              </div>
              <div className="grid gap-2">
                <ReqLabel htmlFor="province">{t("province")}</ReqLabel>
                <SearchableSelect
                  id="province"
                  name="province"
                  required
                  defaultValue={province}
                  placeholder={t("province")}
                  searchPlaceholder={t("provinceSearchPlaceholder")}
                  emptyText={t("provinceEmpty")}
                  ariaLabel={t("province")}
                  options={THAI_PROVINCES.map((p) => ({ value: p, label: p }))}
                  onChange={setProvince}
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                name="outOfProvince"
                value="true"
                className="mt-1 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span>
                <span className="font-medium">{t("outOfProvinceLabel")}</span>
                <span className="block text-xs text-muted-foreground">{t("outOfProvinceHelper")}</span>
              </span>
            </label>
          </fieldset>

          <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("scheduleSectionTitle")}</legend>
            <p className="-mt-1 text-xs text-muted-foreground">{t("scheduleSectionHelper")}</p>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="grid gap-2 min-w-0">
                <ReqLabel htmlFor="startAt">{t("startLabel")}</ReqLabel>
                <DateTimePicker
                  id="startAt"
                  name="startAt"
                  required
                  min={minStart}
                  max={maxStart}
                  defaultValue={startValue}
                  placeholder={t("startLabel")}
                  onChange={setStartValue}
                />
              </div>
              <div className="grid gap-2 min-w-0">
                <ReqLabel htmlFor="endAt">{t("endLabel")}</ReqLabel>
                <DateTimePicker
                  id="endAt"
                  name="endAt"
                  required
                  min={startValue || minStart}
                  max={maxStart}
                  defaultValue={endValue}
                  placeholder={t("endLabel")}
                  onChange={setEndValue}
                />
              </div>
            </div>
            {endBeforeStart && (
              <p className="text-xs font-medium text-destructive">{t("endBeforeStart")}</p>
            )}
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
            <p className="text-xs text-muted-foreground">
              {t("workHoursNotice", {
                from: `${String(WORK_START_HOUR).padStart(2, "0")}:00`,
                to: `${String(WORK_END_HOUR).padStart(2, "0")}:00`,
              })}
            </p>
            {outOfHours && (
              <div className="grid gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/40">
                <ReqLabel htmlFor="outOfHoursReason" className="text-amber-900 dark:text-amber-200">
                  {t("outOfHoursReasonLabel")}
                </ReqLabel>
                <p className="text-xs text-amber-800 dark:text-amber-300">{t("outOfHoursReasonHelper")}</p>
                <Textarea
                  id="outOfHoursReason"
                  name="outOfHoursReason"
                  rows={3}
                  required
                  placeholder={t("outOfHoursReasonPlaceholder")}
                />
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("loadSectionTitle")}</legend>
            <p className="-mt-1 text-xs text-muted-foreground">{t("loadSectionHelper")}</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <ReqLabel htmlFor="passengerCount">{t("passengerCount")}</ReqLabel>
                <PassengerStepper min={1} max={60} />
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
          </fieldset>

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
