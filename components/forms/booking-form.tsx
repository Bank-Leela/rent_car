"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, addYears, format, isSameDay, startOfDay } from "date-fns";
import { useTranslations } from "next-intl";
import type { TripTemplate } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
  BANGKOK_PROVINCE,
  LEAD_TIME_BANGKOK_DAYS,
  LEAD_TIME_OUTSIDE_DAYS,
  LEAD_TIME_URGENT_DAYS,
} from "@/lib/booking/rules";
import { createBookingAction } from "@/lib/booking/actions";
import { createPlaceAction } from "@/lib/places/actions";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  saveTripTemplateAction,
  renameTripTemplateAction,
  deleteTripTemplateAction,
} from "@/lib/booking/template-actions";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { MapPin, Pencil, Trash2, BookmarkPlus, ChevronDown } from "lucide-react";
import { isThaiLocale } from "@/i18n/config";

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
 * Passenger count: typeable number field flanked by −/+ buttons. Controlled by
 * the parent so applying a template can set it. Keeps `name="passengerCount"`
 * so the form action reads it from FormData. Native spinners are suppressed;
 * the −/+ buttons are the 44px touch targets.
 */
function PassengerStepper({
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
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onChange(String(Number.isNaN(num) ? min : clamp(num)))}
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

export type BookingFormPlace = {
  id: string;
  label: string;
  destination: string;
  province: string;
  googleMapsUrl: string | null;
};

/**
 * Inline "save this destination" — creates a SavedPlace from the current
 * destination/province/maps-link (read from the DOM, matching this form's
 * uncontrolled-input style) after prompting for a label.
 */
function SaveDestination() {
  const t = useTranslations("bookingForm");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const readDom = (id: string) =>
    (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {t("savePlaceCta")}
        </button>
        {saved && <span className="text-xs text-muted-foreground">{t("savePlaceSaved")}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t("savePlaceNamePlaceholder")}
        className="h-9 max-w-xs"
      />
      <Button
        type="button"
        size="sm"
        disabled={pending || label.trim().length < 1}
        onClick={() => {
          const destination = readDom("destination");
          const province = readDom("province");
          const mapsUrl = readDom("googleMapsUrl");
          if (destination.length < 2) return;
          const f = new FormData();
          f.append("label", label.trim());
          f.append("destination", destination);
          f.append("province", province);
          if (mapsUrl) f.append("googleMapsUrl", mapsUrl);
          start(async () => {
            const res = await createPlaceAction(f);
            if (res.ok) {
              setSaved(true);
              setOpen(false);
              setLabel("");
              router.refresh();
            }
          });
        }}
      >
        {tc("save")}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
        {tc("cancel")}
      </Button>
    </div>
  );
}

export function BookingForm({
  departments,
  defaultDepartmentId,
  defaultAjarnName,
  defaultAjarnPhone,
  defaultAjarnEmail,
  templates,
  places = [],
  locale,
}: {
  departments: BookingFormDepartment[];
  defaultDepartmentId: string | null;
  // Pre-fill from the requester's own User profile — editing these in the
  // form backfills the profile if it was missing (see createBookingAction).
  defaultAjarnName: string;
  defaultAjarnPhone: string;
  defaultAjarnEmail: string;
  templates: TripTemplate[];
  places?: BookingFormPlace[];
  locale: string;
}) {
  const t = useTranslations("bookingForm");
  const now = new Date();
  const formRef = useRef<HTMLFormElement>(null);
  const [outOfProvince, setOutOfProvince] = useState<boolean>(false);
  // Urgent ("จองเร่งด่วน"): waives the lead-time floor (down to 1 day) and
  // routes the trip to manual admin assignment. Lifted here because it drives
  // the date picker's min + the lead-time notice, and is toggled from inside
  // the start picker.
  const [isEmergency, setIsEmergency] = useState(false);
  // Controlled (default true) so an unchecked box reliably sends "false" —
  // an unchecked native checkbox sends nothing at all, which would fall back
  // to the schema default (true) and silently ignore the uncheck.
  const [waitAtDestination, setWaitAtDestination] = useState(true);
  // Only meaningful when waitAtDestination is false; cleared on submit
  // otherwise so a stale typed time never lingers once "คอย" is re-selected.
  const [pickupReturnTime, setPickupReturnTime] = useState("");
  // Controlled so applying a template can set it (PassengerStepper reads it).
  const [passengerCount, setPassengerCount] = useState<string>("1");
  // Controlled so the outsourcing checkbox can react to it: a bus is always
  // an outsourced rental, regardless of what the requester ticks.
  const [preferredVehicleType, setPreferredVehicleType] = useState("VAN");
  const isBus = preferredVehicleType === "BUS_OUTSOURCED";
  const [needsOutsourcing, setNeedsOutsourcing] = useState(false);
  const isThai = isThaiLocale(locale);
  const defaultDepartment = departments.find((d) => d.id === defaultDepartmentId) ?? null;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ---- Trip templates (saved presets) ----
  const [templateName, setTemplateName] = useState("");
  const [templateMsg, setTemplateMsg] = useState<string | null>(null);
  const [templateBusy, startTemplateTransition] = useTransition();

  // Fill the form from a saved template — everything except the dates, which
  // the requester still picks. Uncontrolled inputs are set on the DOM; the few
  // controlled fields go through their setters.
  const applyTemplate = (tpl: TripTemplate) => {
    const set = (id: string, v: string | number | null) => {
      const el = document.getElementById(id) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null;
      if (el) el.value = v == null ? "" : String(v);
    };
    set("purpose", tpl.purpose);
    set("destination", tpl.destination);
    set("pickupLocation", tpl.pickupLocation);
    setPickupReturnTime(tpl.pickupReturnTime ?? "");
    set("ajarnName", tpl.ajarnName);
    set("ajarnPhone", tpl.ajarnPhone);
    set("ajarnEmail", tpl.ajarnEmail);
    set("coordinatorName", tpl.coordinatorName);
    set("coordinatorPhone", tpl.coordinatorPhone);
    set("maleCount", tpl.maleCount);
    set("femaleCount", tpl.femaleCount);
    set("passengerNotes", tpl.passengerNotes);
    setPassengerCount(String(tpl.passengerCount ?? 1));
    setOutOfProvince(tpl.outOfProvince);
    setIsEmergency(tpl.isEmergency);
    setWaitAtDestination(tpl.waitAtDestination);
    setPreferredVehicleType(tpl.preferredVehicleType);
    setNeedsOutsourcing(tpl.needsOutsourcing);
    const setChk = (name: string, checked: boolean) => {
      const el = document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
      if (el) el.checked = checked;
    };
    setChk("travelWithinChula", tpl.travelWithinChula);
    setTemplateMsg(t("templateApplied", { name: tpl.name }));
  };

  const saveTemplate = () => {
    const form = formRef.current;
    if (!form) return;
    const name = templateName.trim();
    if (!name) {
      setTemplateMsg(t("templateNameRequired"));
      return;
    }
    // Reuse the live form fields; the schema ignores the date/recurrence keys.
    const fd = new FormData(form);
    fd.set("name", name);
    startTemplateTransition(async () => {
      const res = await saveTripTemplateAction(fd);
      if (res.ok) {
        setTemplateName("");
        setTemplateMsg(t("templateSaved", { name }));
      } else {
        setTemplateMsg(res.error);
      }
    });
  };

  const renameTemplate = (tpl: TripTemplate) => {
    const next = window.prompt(t("templateRenamePrompt"), tpl.name);
    if (next == null) return;
    const name = next.trim();
    if (!name) return;
    const fd = new FormData();
    fd.set("id", tpl.id);
    fd.set("name", name);
    startTemplateTransition(async () => {
      const res = await renameTripTemplateAction(fd);
      setTemplateMsg(res.ok ? null : res.error);
    });
  };

  const deleteTemplate = (tpl: TripTemplate) => {
    if (!window.confirm(t("templateDeleteConfirm", { name: tpl.name }))) return;
    const fd = new FormData();
    fd.set("id", tpl.id);
    startTemplateTransition(async () => {
      const res = await deleteTripTemplateAction(fd);
      setTemplateMsg(res.ok ? null : res.error);
    });
  };

  const requiredDays = isEmergency
    ? LEAD_TIME_URGENT_DAYS
    : outOfProvince
      ? LEAD_TIME_OUTSIDE_DAYS
      : LEAD_TIME_BANGKOK_DAYS;
  // Earliest is midnight on (today + requiredDays); any time on that day is fine.
  const earliestStart = startOfDay(addDays(now, requiredDays));
  const minStart = datetimeLocalValue(earliestStart);
  // Cap typed year so the browser can't accept "20251" or longer.
  const maxStart = datetimeLocalValue(addYears(now, 5));
  const earliestDateLabel = format(earliestStart, "EEE d MMM yyyy");

  const [startValue, setStartValue] = useState<string>("");
  const [endValue, setEndValue] = useState<string>("");

  // The end DATE is never freely chosen — it's derived from the start date
  // plus the overnight toggle: same calendar day when not overnight, the day
  // after when overnight. Whenever start or overnight changes, we correct
  // end's date to match. We never invent a TIME on the requester's behalf —
  // if they haven't picked an end time yet, it stays blank; if they have, we
  // shift its date and keep the time-of-day they chose.
  const startDateObj = startValue ? new Date(startValue) : null;
  const startIsValid = !!startDateObj && !Number.isNaN(startDateObj.getTime());
  const requiredEndDay = startIsValid
    ? outOfProvince
      ? addDays(startOfDay(startDateObj!), 1)
      : startOfDay(startDateObj!)
    : null;
  const endDayValue = requiredEndDay ? datetimeLocalValue(requiredEndDay) : undefined;

  useEffect(() => {
    if (!requiredEndDay) return;
    const day = requiredEndDay;
    setEndValue((prev) => {
      if (!prev) return prev; // no end time chosen yet — nothing to correct
      const prevDate = new Date(prev);
      if (Number.isNaN(prevDate.getTime())) return prev;
      if (isSameDay(prevDate, day)) return prev; // already compliant
      // Shift the date only; keep whatever time the requester already chose.
      const next = new Date(day);
      next.setHours(prevDate.getHours(), prevDate.getMinutes(), 0, 0);
      return datetimeLocalValue(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `requiredEndDay` is a new Date each render; depend on its primitive instead to avoid an infinite loop.
  }, [requiredEndDay?.getTime()]);

  const handleStartChange = (v: string) => {
    setStartValue(v);
  };

  const handleEndChange = (v: string) => {
    setEndValue(v);
  };

  // Open the stored Maps link when present; otherwise fall back to a name-search
  // of the typed destination. No API key — plain maps.google.com.
  const openDestinationInMaps = () => {
    const stored = (
      document.getElementById("googleMapsUrl") as HTMLInputElement | null
    )?.value.trim();
    if (stored) {
      window.open(stored, "_blank", "noopener,noreferrer");
      return;
    }
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
  // than a browser-native tooltip.
  const baseRequired: Array<{ name: string; labelKey: string }> = [
    { name: "startAt", labelKey: "startLabel" },
    { name: "endAt", labelKey: "endLabel" },
    { name: "purpose", labelKey: "purpose" },
    { name: "destination", labelKey: "destination" },
    { name: "googleMapsUrl", labelKey: "mapsLinkLabel" },
    { name: "pickupLocation", labelKey: "pickupLocation" },
    { name: "province", labelKey: "province" },
    { name: "passengerCount", labelKey: "passengerCount" },
    { name: "ajarnName", labelKey: "ajarnName" },
    { name: "departmentId", labelKey: "department" },
    { name: "ajarnPhone", labelKey: "ajarnPhone" },
    { name: "ajarnEmail", labelKey: "ajarnEmail" },
    { name: "coordinatorName", labelKey: "coordinatorName" },
    { name: "coordinatorPhone", labelKey: "coordinatorPhone" },
  ];

  const richStrong = { strong: (chunks: React.ReactNode) => <strong>{chunks}</strong> };

  return (
    <Card>
      <CardHeader>
        {!isEmergency && (
          <CardDescription>
            {t.rich(outOfProvince ? "leadTimeOutside" : "leadTimeBangkok", {
              ...richStrong,
              days: requiredDays,
            })}{" "}
            {t.rich("earliestSentence", { ...richStrong, date: earliestDateLabel })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          onSubmit={(e) => {
            // Use onSubmit (not the `action` prop) so React 19 does NOT
            // auto-reset the form after the handler runs. With `action`, a
            // validation error would wipe every field the requester typed.
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            setError(null);
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
          <div className="space-y-3 rounded-md border border-dashed bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <BookmarkPlus aria-hidden className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{t("templatesTitle")}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t("templatesHelper")}</p>

            {templates.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {templates.map((tpl) => (
                  <li
                    key={tpl.id}
                    className="inline-flex items-center gap-1 rounded-md border bg-background py-1 pl-1 pr-1.5 text-sm"
                  >
                    <button
                      type="button"
                      onClick={() => applyTemplate(tpl)}
                      className="rounded px-2 py-0.5 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {tpl.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => renameTemplate(tpl)}
                      aria-label={t("templateRename", { name: tpl.name })}
                      className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTemplate(tpl)}
                      aria-label={t("templateDelete", { name: tpl.name })}
                      className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder={t("templateNamePlaceholder")}
                aria-label={t("templateNamePlaceholder")}
                className="h-9 w-full sm:w-64"
              />
              <Button
                type="button"
                variant="outline"
                onClick={saveTemplate}
                disabled={templateBusy}
                className="h-9"
              >
                {t("saveTemplate")}
              </Button>
            </div>
            {templateMsg && (
              <p className="text-xs font-medium text-muted-foreground">{templateMsg}</p>
            )}
          </div>

          <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("scheduleSectionTitle")}</legend>
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
                  overnight={{
                    value: outOfProvince,
                    onChange: setOutOfProvince,
                    label: t("outOfProvinceLabel"),
                    helper: t("outOfProvinceHelper"),
                    warning: t("outOfProvinceLeadWarning", { days: LEAD_TIME_OUTSIDE_DAYS }),
                    yesLabel: t("overnightYes"),
                    noLabel: t("overnightNo"),
                  }}
                  urgent={{
                    value: isEmergency,
                    onChange: setIsEmergency,
                    label: t("emergencyLabel"),
                    helper: t("emergencyHelper"),
                    yesLabel: t("overnightYes"),
                    noLabel: t("overnightNo"),
                  }}
                />
              </div>
              <div className="grid gap-2 min-w-0">
                <ReqLabel htmlFor="endAt">{t("endLabel")}</ReqLabel>
                <DateTimePicker
                  id="endAt"
                  name="endAt"
                  required
                  min={endDayValue ?? (startValue || minStart)}
                  max={endDayValue ?? maxStart}
                  defaultValue={endValue}
                  placeholder={t("endLabel")}
                  onChange={handleEndChange}
                  pickupReturn={{
                    wait: waitAtDestination,
                    onWaitChange: setWaitAtDestination,
                    pickupTime: pickupReturnTime,
                    onPickupTimeChange: setPickupReturnTime,
                    label: t("waitAtDestinationLabel"),
                    helper: t("waitAtDestinationHelper"),
                    waitYesLabel: t("waitYes"),
                    waitNoLabel: t("waitNo"),
                    pickupTimeLabel: t("pickupReturnTimeLabel"),
                  }}
                />
              </div>
              {/* Empty cell keeps the helper text under End only, while the
                  pickers above stay aligned regardless of how many lines the
                  helper text wraps to. */}
              <div />
              <p className="text-xs text-muted-foreground">
                {t.rich("endHelper", richStrong)}
              </p>
            </div>
            {endBeforeStart && (
              <p className="text-xs font-medium text-destructive">{t("endBeforeStart")}</p>
            )}
            {startIsValid && (
              <p className="text-xs text-muted-foreground">
                {outOfProvince ? t("endDateAutoNextDay") : t("endDateAutoSameDay")}
              </p>
            )}

            {/* คอย/ไม่คอย is toggled from inside the End date picker (it's
                about what happens before the return trip, so it belongs next
                to the date). Both ride along as hidden fields. waitAtDestination
                must emit "true"/"" — never "false" — because z.coerce.boolean
                treats any non-empty string as true. pickupReturnTime is only
                meaningful (and only shown) when not waiting; clear it
                otherwise so a stale typed value never lingers. */}
            <input
              type="hidden"
              name="waitAtDestination"
              value={waitAtDestination ? "true" : ""}
            />
            <input
              type="hidden"
              name="pickupReturnTime"
              value={waitAtDestination ? "" : pickupReturnTime}
            />

            {/* Low-key disclosure matching the urgent toggle's style — a
                routine option, but not so prominent it gets clicked by habit. */}
            <details className="group">
              <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                <span>{t("recurringSummary")}</span>
                <ChevronDown
                  aria-hidden
                  className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="mt-2 space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">
                  {t("recurringDescription")}
                </p>
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

          <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("tripSectionTitle")}</legend>
            <div className="grid gap-2">
              <ReqLabel htmlFor="purpose">{t("purpose")}</ReqLabel>
              <Input id="purpose" name="purpose" required />
            </div>
            <div className="grid gap-2">
              <ReqLabel htmlFor="pickupLocation">{t("pickupLocation")}</ReqLabel>
              <Input
                id="pickupLocation"
                name="pickupLocation"
                required
                defaultValue="หน้าอาคารอานันทมหิดล"
                placeholder={t("pickupLocationPlaceholder")}
              />
            </div>
            {places.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="savedPlace">{t("savedPlaceLabel")}</Label>
                <SearchableSelect
                  id="savedPlace"
                  name="savedPlace"
                  placeholder={t("savedPlacePlaceholder")}
                  emptyText={t("savedPlaceNone")}
                  options={places.map((p) => ({ value: p.id, label: p.label }))}
                  onChange={(id) => {
                    const p = places.find((x) => x.id === id);
                    if (!p) return;
                    const setVal = (eid: string, v: string) => {
                      const el = document.getElementById(eid) as HTMLInputElement | null;
                      if (el) el.value = v;
                    };
                    setVal("destination", p.destination);
                    setVal("googleMapsUrl", p.googleMapsUrl ?? "");
                  }}
                />
                <a
                  href="/requester/places"
                  className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {t("managePlacesLink")}
                </a>
              </div>
            )}
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
            <div className="grid gap-2">
              <ReqLabel htmlFor="googleMapsUrl">{t("mapsLinkLabel")}</ReqLabel>
              <Input
                id="googleMapsUrl"
                name="googleMapsUrl"
                type="url"
                inputMode="url"
                required
                placeholder="https://maps.app.goo.gl/…"
              />
              <span className="text-xs text-muted-foreground">{t("mapsLinkHelper")}</span>
              <SaveDestination />
            </div>
            {/* Province + outOfProvince are derived from the overnight Yes/No
                toggle that now lives inside the start date picker (it drives
                lead time, so it belongs next to the date). Both ride along as
                hidden fields. outOfProvince must emit "true"/"" — never
                "false" — because z.coerce.boolean treats any non-empty string
                as true. id="province" lets the saved-place inline-save read it. */}
            <input
              type="hidden"
              id="province"
              name="province"
              value={outOfProvince ? "ต่างจังหวัด" : BANGKOK_PROVINCE}
            />
            <input type="hidden" name="outOfProvince" value={outOfProvince ? "true" : ""} />
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                name="travelWithinChula"
                value="true"
                className="mt-1 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span>
                <span className="font-medium">{t("travelWithinChulaLabel")}</span>
                <span className="block text-xs text-muted-foreground">{t("travelWithinChulaHelper")}</span>
              </span>
            </label>
            {/* Sub-project A: campus/off-campus hint (separate signal from the
                WERN-forcing travelWithinChula above; surfaced as a chip). */}
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
          </fieldset>

          <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("loadSectionTitle")}</legend>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="grid gap-2">
                <ReqLabel htmlFor="passengerCount">{t("passengerCount")}</ReqLabel>
                <PassengerStepper
                  value={passengerCount}
                  onChange={setPassengerCount}
                  min={1}
                  max={60}
                />
              </div>
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
              <ReqLabel htmlFor="preferredVehicleType">{t("preferredVehicle")}</ReqLabel>
              <select
                id="preferredVehicleType"
                name="preferredVehicleType"
                required
                value={preferredVehicleType}
                onChange={(e) => setPreferredVehicleType(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="VAN">{t("preferredVehicleVan")}</option>
                <option value="TRUCK_6_WHEEL">{t("preferredVehicleTruck6Wheel")}</option>
                <option value="PICKUP">{t("preferredVehiclePickup")}</option>
                <option value="SEDAN_DEAN">{t("preferredVehicleSedanDean")}</option>
                <option value="BUS_OUTSOURCED">{t("preferredVehicleBusOutsourced")}</option>
              </select>
              {/* Bus is always an outsourced rental — backend forces
                  needsOutsourcing regardless of this checkbox, so reflect
                  that truth here instead of leaving it editable. */}
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isBus || needsOutsourcing}
                  disabled={isBus}
                  onChange={(e) => setNeedsOutsourcing(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                />
                <span>
                  <span className="font-medium">{t("flagOutsourcing")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {isBus ? t("flagOutsourcingBusNotice") : t("flagOutsourcingHelper")}
                  </span>
                </span>
              </label>
              <input
                type="hidden"
                name="needsOutsourcing"
                value={isBus || needsOutsourcing ? "true" : ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="passengerNotes">{t("passengerNotes")}</Label>
              <Textarea id="passengerNotes" name="passengerNotes" rows={3} />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("ajarnSectionTitle")}</legend>
            <p className="-mt-1 text-xs text-muted-foreground">{t("ajarnSectionHelper")}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("requesterGroupTitle")}
            </p>
            <div className="grid gap-2">
              <ReqLabel htmlFor="ajarnName">{t("ajarnName")}</ReqLabel>
              <Input
                id="ajarnName"
                name="ajarnName"
                required
                autoComplete="off"
                defaultValue={defaultAjarnName}
              />
            </div>
            <div className="grid gap-2">
              <ReqLabel htmlFor="departmentDisplay">{t("department")}</ReqLabel>
              {/* Locked: the department rides on the user profile, not the form. */}
              <input type="hidden" id="departmentId" name="departmentId" value={defaultDepartmentId ?? ""} />
              <Input
                id="departmentDisplay"
                value={
                  defaultDepartment
                    ? isThai
                      ? defaultDepartment.nameTh
                      : defaultDepartment.nameEn
                    : t("departmentNotSet")
                }
                readOnly
                disabled
              />
              <p className="text-xs text-muted-foreground">
                {t("departmentLockedHint")}{" "}
                <a href="/account" className="font-medium text-primary hover:underline">
                  {t("departmentEditLink")}
                </a>
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <ReqLabel htmlFor="ajarnPhone">{t("ajarnPhone")}</ReqLabel>
                <Input
                  id="ajarnPhone"
                  name="ajarnPhone"
                  type="tel"
                  required
                  autoComplete="off"
                  defaultValue={defaultAjarnPhone}
                />
              </div>
              <div className="grid gap-2">
                <ReqLabel htmlFor="ajarnEmail">{t("ajarnEmail")}</ReqLabel>
                <Input
                  id="ajarnEmail"
                  name="ajarnEmail"
                  type="email"
                  required
                  autoComplete="off"
                  defaultValue={defaultAjarnEmail}
                />
              </div>
            </div>
            <div className="space-y-3 border-t pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("coordinatorGroupTitle")}
              </p>
              <div className="grid gap-2">
                <ReqLabel htmlFor="coordinatorName">{t("coordinatorName")}</ReqLabel>
                <Input id="coordinatorName" name="coordinatorName" required autoComplete="off" />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
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

          {/* Urgent ("จองเร่งด่วน") is toggled from inside the start date
              picker (it waives the lead time, so it belongs next to the date).
              It rides along as a hidden field — "true"/"" only, never "false",
              because z.coerce.boolean treats any non-empty string as true. */}
          <input type="hidden" name="isEmergency" value={isEmergency ? "true" : ""} />

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
