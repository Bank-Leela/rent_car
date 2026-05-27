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
  if (startValue && endValue) {
    const s = new Date(startValue);
    const e = new Date(endValue);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
      outOfHours = !isWithinWorkHours({ startAt: s, endAt: e });
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
    { name: "jobType", labelKey: "jobTypeLabel" },
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
          action={(formData) => {
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

          <div className="grid gap-2">
            <ReqLabel htmlFor="purpose">{t("purpose")}</ReqLabel>
            <Input id="purpose" name="purpose" required />
          </div>

          <div className="grid gap-2">
            <ReqLabel htmlFor="jobType">{t("jobTypeLabel")}</ReqLabel>
            <SearchableSelect
              id="jobType"
              name="jobType"
              required
              placeholder={t("jobTypePlaceholder")}
              ariaLabel={t("jobTypeLabel")}
              options={[
                { value: "GENERAL", label: t("jobTypeGeneral") },
                { value: "OT", label: t("jobTypeOT") },
                { value: "OUT_OF_PROVINCE", label: t("jobTypeOutOfProvince") },
                { value: "ON_CALL", label: t("jobTypeOnCall") },
              ]}
            />
            <p className="text-xs text-muted-foreground">{t("jobTypeHelper")}</p>
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

          <div className="space-y-3">
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
                  min={minStart}
                  max={maxStart}
                  defaultValue={endValue}
                  placeholder={t("endLabel")}
                  onChange={setEndValue}
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
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <ReqLabel htmlFor="passengerCount">{t("passengerCount")}</ReqLabel>
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
