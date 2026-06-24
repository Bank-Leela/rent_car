"use client";

import { useState, useTransition } from "react";
import { addDays, addYears, format, startOfDay } from "date-fns";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import {
  BANGKOK_PROVINCE,
  LEAD_TIME_BANGKOK_DAYS,
  LEAD_TIME_OUTSIDE_DAYS,
} from "@/lib/booking/rules";
import { createBookingAction } from "@/lib/booking/actions";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Lock, MapPin } from "lucide-react";

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

export type BookingFormVehicle = {
  id: string;
  registrationNumber: string;
  capacity: number;
};

/** The requester's own department, resolved from their profile and locked. */
export type BookingFormUserDepartment = {
  id: string;
  name: string;
};


export function BookingForm({
  vehicles,
  userDepartment,
}: {
  vehicles: BookingFormVehicle[];
  userDepartment: BookingFormUserDepartment | null;
}) {
  const t = useTranslations("bookingForm");
  const now = new Date();
  // Province drives both the lead-time rule (Bangkok vs. out-of-province) and
  // the card heading. The overnight checkbox below only flags TJW.
  const [province, setProvince] = useState<string>(BANGKOK_PROVINCE);
  const [outOfProvince, setOutOfProvince] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isOutside = province.trim() !== "" && province.trim() !== BANGKOK_PROVINCE;
  const requiredDays = isOutside ? LEAD_TIME_OUTSIDE_DAYS : LEAD_TIME_BANGKOK_DAYS;
  // Earliest is midnight on (today + requiredDays); any time on that day is fine.
  const earliestStart = startOfDay(addDays(now, requiredDays));
  const minStart = datetimeLocalValue(earliestStart);
  // Cap typed year so the browser can't accept "20251" or longer.
  const maxStart = datetimeLocalValue(addYears(now, 5));
  const earliestDateLabel = format(earliestStart, "EEE d MMM yyyy");

  const [startValue, setStartValue] = useState<string>("");
  const [endValue, setEndValue] = useState<string>("");
  // Once the user edits the end themselves, stop auto-tracking it off the start.
  const [endTouched, setEndTouched] = useState(false);
  const [isEmergency, setIsEmergency] = useState(false);

  const fillEarliest = () => {
    const start = new Date(earliestStart);
    start.setHours(8, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 4);
    setStartValue(datetimeLocalValue(start));
    setEndValue(datetimeLocalValue(end));
    setEndTouched(true);
  };

  // Default the end to 2h after start (same calendar day) whenever the user
  // changes the start, until they pick an end of their own — keeps the end
  // date matching the start date by default.
  const handleStartChange = (v: string) => {
    setStartValue(v);
    if (endTouched) return; // user chose their own end — leave it alone
    const start = new Date(v);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start);
    end.setHours(start.getHours() + 2);
    if (startOfDay(end).getTime() === startOfDay(start).getTime()) {
      setEndValue(datetimeLocalValue(end));
    }
  };

  const handleEndChange = (v: string) => {
    setEndValue(v);
    setEndTouched(true);
  };

  // Open Google Maps in a new tab, searching for whatever destination the
  // requester has typed. No API key — just a maps.google.com search URL.
  const openDestinationInMaps = () => {
    const dest = (
      document.getElementById("destination") as HTMLInputElement | null
    )?.value.trim();
    const url = dest
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`
      : "https://www.google.com/maps";
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // End must be strictly after start. Computed live so we can both warn inline
  // and block submission before the (English-only) server refine fires.
  let endBeforeStart = false;
  if (startValue && endValue) {
    const s = new Date(startValue);
    const e = new Date(endValue);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
      endBeforeStart = e.getTime() <= s.getTime();
    }
  }

  // Required-field names + the translation key for each label, used to
  // pre-validate the submission so the user sees an in-form message rather
  // than a browser-native tooltip. departmentId is omitted — it is locked to
  // the profile and resolved server-side.
  const baseRequired: Array<{ name: string; labelKey: string }> = [
    { name: "purpose", labelKey: "purpose" },
    { name: "destination", labelKey: "destination" },
    { name: "province", labelKey: "province" },
    { name: "startAt", labelKey: "startLabel" },
    { name: "endAt", labelKey: "endLabel" },
    { name: "passengerCount", labelKey: "passengerCount" },
    { name: "ajarnName", labelKey: "ajarnName" },
    { name: "ajarnPhone", labelKey: "ajarnPhone" },
    { name: "ajarnEmail", labelKey: "ajarnEmail" },
    { name: "coordinatorName", labelKey: "coordinatorName" },
    { name: "coordinatorPhone", labelKey: "coordinatorPhone" },
  ];

  const richStrong = { strong: (chunks: React.ReactNode) => <strong>{chunks}</strong> };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {t.rich(isOutside ? "leadTimeOutside" : "leadTimeBangkok", {
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
            if (!userDepartment) {
              setError(t("noDepartmentBody"));
              return;
            }
            const missing = baseRequired.filter((f) => {
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

          {/* 1. Requester & coordinator */}
          <fieldset className="space-y-4 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("ajarnSectionTitle")}</legend>
            <p className="-mt-1 text-xs text-muted-foreground">{t("ajarnSectionHelper")}</p>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("requesterBlockTitle")}
              </p>
              <div className="grid gap-2">
                <ReqLabel htmlFor="ajarnName">{t("ajarnName")}</ReqLabel>
                <Input id="ajarnName" name="ajarnName" required autoComplete="off" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="departmentDisplay">{t("department")}</Label>
                {userDepartment ? (
                  <>
                    <div
                      id="departmentDisplay"
                      className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
                    >
                      <Lock aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>{userDepartment.name}</span>
                    </div>
                    <a
                      href="/account"
                      className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      {t("departmentEditLink")}
                    </a>
                  </>
                ) : (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/40">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      {t("noDepartmentTitle")}
                    </p>
                    <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
                      {t("noDepartmentBody")}
                    </p>
                    <a
                      href="/account"
                      className="mt-2 inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      {t("departmentEditLink")}
                    </a>
                  </div>
                )}
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
            </div>

            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("coordinatorBlockTitle")}
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <ReqLabel htmlFor="coordinatorName">{t("coordinatorName")}</ReqLabel>
                  <Input id="coordinatorName" name="coordinatorName" required autoComplete="off" />
                </div>
                <div className="grid gap-2">
                  <ReqLabel htmlFor="coordinatorPhone">{t("coordinatorPhone")}</ReqLabel>
                  <Input
                    id="coordinatorPhone"
                    name="coordinatorPhone"
                    type="tel"
                    required
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
          </fieldset>

          {/* 2. Date & time (+ recurring) */}
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
                  max={endValue || maxStart}
                  defaultValue={startValue}
                  placeholder={t("startLabel")}
                  onChange={handleStartChange}
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
                  onChange={handleEndChange}
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
            <details className="rounded-md border bg-background p-3">
              <summary className="cursor-pointer text-sm font-medium">{t("recurringSummary")}</summary>
              <div className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">{t("recurringDescription")}</p>
                <RecurrenceWeekdays />
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="recurringUntil">{t("repeatUntil")}</Label>
                    <DateTimePicker
                      id="recurringUntil"
                      name="recurringUntil"
                      dateOnly
                      min={startValue || minStart}
                      max={maxStart}
                      placeholder={t("repeatUntil")}
                    />
                  </div>
                </div>
              </div>
            </details>
          </fieldset>

          {/* 3. Purpose & destination */}
          <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("tripSectionTitle")}</legend>
            <p className="-mt-1 text-xs text-muted-foreground">{t("tripSectionHelper")}</p>
            <div className="grid gap-2">
              <ReqLabel htmlFor="purpose">{t("purpose")}</ReqLabel>
              <Input id="purpose" name="purpose" required />
            </div>
            <div className="grid gap-2">
              <ReqLabel htmlFor="destination">{t("destination")}</ReqLabel>
              <Input id="destination" name="destination" required />
              <button
                type="button"
                onClick={openDestinationInMaps}
                className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <MapPin aria-hidden className="h-3.5 w-3.5" />
                {t("destinationMapsLink")}
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <ReqLabel htmlFor="province">{t("province")}</ReqLabel>
                <Input
                  id="province"
                  name="province"
                  required
                  value={province}
                  onChange={(e) => setProvince(e.target.value)}
                  placeholder={t("provincePlaceholder")}
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tripType">{t("tripDirectionLabel")}</Label>
                <SelectField
                  id="tripType"
                  name="tripType"
                  defaultValue=""
                  className="h-10"
                  options={[
                    { value: "", label: t("tripDirectionNone") },
                    { value: "ROUND_TRIP", label: t("tripRoundTrip") },
                    { value: "DROP_OFF", label: t("tripDropOff") },
                    { value: "PICK_UP_DROP_OFF", label: t("tripPickupDropOff") },
                  ]}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pickupLocation">{t("pickupLocation")}</Label>
              <Input
                id="pickupLocation"
                name="pickupLocation"
                placeholder={t("pickupLocationPlaceholder")}
              />
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                name="outsideChula"
                value="true"
                className="mt-1 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span>
                <span className="font-medium">{t("outsideChulaLabel")}</span>
                <span className="block text-xs text-muted-foreground">{t("outsideChulaHelper")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                name="outOfProvince"
                value="true"
                checked={outOfProvince}
                onChange={(e) => setOutOfProvince(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span>
                <span className="font-medium">{t("outOfProvinceLabel")}</span>
                <span className="block text-xs text-muted-foreground">{t("outOfProvinceHelper")}</span>
              </span>
            </label>
          </fieldset>

          {/* 4. Passengers & details */}
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
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="maleCount">{t("maleCount")}</Label>
                <Input id="maleCount" name="maleCount" type="number" min={0} placeholder="0" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="femaleCount">{t("femaleCount")}</Label>
                <Input id="femaleCount" name="femaleCount" type="number" min={0} placeholder="0" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="preferredVehicleId">{t("preferredVehicle")}</Label>
              <SelectField
                id="preferredVehicleId"
                name="preferredVehicleId"
                defaultValue=""
                className="h-10"
                options={[
                  { value: "", label: t("preferredVehicleNone") },
                  ...vehicles.map((v) => ({ value: v.id, label: `${v.registrationNumber} · ${v.capacity}` })),
                ]}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="passengerNotes">{t("passengerNotes")}</Label>
              <Textarea id="passengerNotes" name="passengerNotes" rows={3} />
            </div>
          </fieldset>

          {/* Remark */}
          <div className="grid gap-2">
            <Label htmlFor="remark">{t("remarkLabel")}</Label>
            <Textarea id="remark" name="remark" rows={3} placeholder={t("remarkPlaceholder")} />
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="needsOutsourcing"
              value="true"
              className="mt-1 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span>
              <span className="font-medium">{t("flagOutsourcing")}</span>
              <span className="block text-xs text-muted-foreground">{t("flagOutsourcingHelper")}</span>
            </span>
          </label>

          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                name="isEmergency"
                value="true"
                checked={isEmergency}
                onChange={(e) => setIsEmergency(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span>
                <span className="font-medium">{t("emergencyLabel")}</span>
                <span className="block text-xs text-muted-foreground">{t("emergencyHelper")}</span>
              </span>
            </label>
            {isEmergency && (
              <div className="grid gap-2">
                <Label htmlFor="emergencyReason">{t("emergencyReasonLabel")}</Label>
                <Textarea
                  id="emergencyReason"
                  name="emergencyReason"
                  rows={3}
                  placeholder={t("emergencyReasonPlaceholder")}
                />
              </div>
            )}
          </div>

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
