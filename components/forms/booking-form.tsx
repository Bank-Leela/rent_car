"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addBusinessDays, addDays, addYears, format, isSameDay, startOfDay } from "date-fns";
import { useTranslations } from "next-intl";
import type { TripTemplate } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  BANGKOK_PROVINCE,
  LEAD_TIME_BANGKOK_DAYS,
  LEAD_TIME_OUTSIDE_DAYS,
  LEAD_TIME_SMUS_DAYS,
  LEAD_TIME_URGENT_DAYS,
} from "@/lib/booking/rules";
import { createBookingAction } from "@/lib/booking/create-booking-action";
import {
  saveTripTemplateAction,
  renameTripTemplateAction,
  deleteTripTemplateAction,
} from "@/lib/booking/template-actions";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  MapPin,
  Pencil,
  Trash2,
  BookmarkPlus,
  ChevronDown,
  Repeat,
  Check,
  MoreVertical,
  Bookmark,
  Paperclip,
  X,
} from "lucide-react";
import { isThaiLocale } from "@/i18n/config";
import { useActionToast } from "@/components/hooks/use-action-toast";
import { ReqLabel, RecurrenceWeekdays, PassengerStepper } from "@/components/forms/booking-form-fields";

const datetimeLocalValue = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

// Where the trip goes. Drives lead time (within Chula / Bangkok metro = 3
// business days, upcountry = 7), รถเวร routing (within Chula), and whether the
// overnight option is offered (upcountry only).
type TripArea = "WITHIN_CHULA" | "BANGKOK_METRO" | "UPCOUNTRY" | "SMUS_CURRICULUM";
const TRIP_AREAS: ReadonlyArray<{ value: TripArea; key: string; helperKey: string }> = [
  { value: "WITHIN_CHULA", key: "tripAreaWithinChula", helperKey: "tripAreaWithinChulaHelper" },
  { value: "BANGKOK_METRO", key: "tripAreaBangkokMetro", helperKey: "tripAreaBangkokMetroHelper" },
  { value: "UPCOUNTRY", key: "tripAreaUpcountry", helperKey: "tripAreaUpcountryHelper" },
  { value: "SMUS_CURRICULUM", key: "tripAreaSmus", helperKey: "tripAreaSmusHelper" },
];

export type BookingFormDepartment = {
  id: string;
  nameEn: string;
  nameTh: string;
};

// The trip fields a form pre-fill carries — the exact set applyFields writes.
// Both saved templates and "book again" (a past booking mapped to this shape)
// go through the same path; dates/recurrence are always left for the requester.
export type BookingPrefill = Pick<
  TripTemplate,
  | "purpose"
  | "destination"
  | "googleMapsUrl"
  | "pickupLocation"
  | "pickupReturnTime"
  | "waitingLocation"
  | "ajarnName"
  | "ajarnPhone"
  | "ajarnEmail"
  | "coordinatorName"
  | "coordinatorPhone"
  | "maleCount"
  | "femaleCount"
  | "passengerNotes"
  | "passengerCount"
  | "travelWithinChula"
  | "outOfProvince"
  | "isEmergency"
  | "returnTrip"
  | "waitAtDestination"
  | "preferredVehicleType"
  | "needsOutsourcing"
>;

export function BookingForm({
  departments,
  defaultDepartmentId,
  defaultAjarnName,
  defaultAjarnPhone,
  defaultAjarnEmail,
  templates,
  prefill,
  prefillLabel,
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
  // "Book again": trip fields of a past booking, applied once on mount.
  prefill?: BookingPrefill | null;
  // Shown in the applied-notice (the source booking's job number).
  prefillLabel?: string;
  locale: string;
}) {
  const t = useTranslations("bookingForm");
  const tt = useTranslations("toast");
  const { toastResult } = useActionToast();
  const now = new Date();
  const formRef = useRef<HTMLFormElement>(null);
  // Trip area drives lead time + รถเวร routing. Overnight is a separate choice
  // offered only for upcountry trips (it just shifts the end date forward).
  const [tripArea, setTripArea] = useState<TripArea>("BANGKOK_METRO");
  const [overnight, setOvernight] = useState(false);
  const isUpcountry = tripArea === "UPCOUNTRY";
  const isWithinChula = tripArea === "WITHIN_CHULA";
  // External charter ("หลักสูตรนิสิตแพทย์"): outside buses/vans, booked off the
  // internal fleet — no vehicle-type pick, no driver/slot allocation.
  const isExternalCharter = tripArea === "SMUS_CURRICULUM";
  const isOvernight = isUpcountry && overnight;
  const [externalBusCount, setExternalBusCount] = useState("0");
  const [externalVanCount, setExternalVanCount] = useState("0");
  const selectTripArea = (next: TripArea) => {
    setTripArea(next);
    // Overnight only applies upcountry; leaving it must clear the choice so the
    // end date snaps back to the same day.
    if (next !== "UPCOUNTRY") setOvernight(false);
  };
  // Urgent ("จองเร่งด่วน"): waives the lead-time floor (down to 1 day) and
  // routes the trip to manual admin assignment. Lifted here because it drives
  // the date picker's min + the lead-time notice, and is toggled from inside
  // the start picker.
  const [isEmergency, setIsEmergency] = useState(false);
  // Controlled (default true) so an unchecked box reliably sends "false" —
  // an unchecked native checkbox sends nothing at all, which would fall back
  // to the schema default (true) and silently ignore the uncheck.
  const [waitAtDestination, setWaitAtDestination] = useState(true);
  // One-way ("ไม่เดินทางกลับ"): the requester only books the outbound leg and
  // leaves the end time to the admin (set at approval). When false the end
  // picker is hidden and a provisional endAt rides along so the server schema
  // (which always wants an endAt) stays happy.
  const [returnTrip, setReturnTrip] = useState(true);
  // Only meaningful when waitAtDestination is false; cleared on submit
  // otherwise so a stale typed time never lingers once "คอย" is re-selected.
  const [pickupReturnTime, setPickupReturnTime] = useState("");
  // No-wait split: when not waiting, the time the driver finishes the drop-off
  // run (leg-1 end). Combined with the start date into a datetime-local on submit.
  const [dropOffTime, setDropOffTime] = useState("");
  // Controlled so applying a template can set it (PassengerStepper reads it).
  const [passengerCount, setPassengerCount] = useState<string>("1");
  // Controlled so the outsourcing checkbox can react to it: a bus is always
  // an outsourced rental, regardless of what the requester ticks.
  const [preferredVehicleType, setPreferredVehicleType] = useState("VAN");
  const isBus = preferredVehicleType === "BUS_OUTSOURCED";
  const [needsOutsourcing, setNeedsOutsourcing] = useState(false);
  // Optional supporting-document attachment (memo, invitation letter, etc.)
  // alongside the remark/notes. Name shown for confirmation; the actual File
  // object lives in the (uncontrolled) file input and rides along in the
  // FormData the submit handler builds.
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const isThai = isThaiLocale(locale);
  const defaultDepartment = departments.find((d) => d.id === defaultDepartmentId) ?? null;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ---- Trip templates (saved presets) ----
  const [templateName, setTemplateName] = useState("");
  const [templateMsg, setTemplateMsg] = useState<string | null>(null);
  // The template most recently applied to the form — highlighted so the
  // requester can see which of several saved presets they last loaded.
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [templateBusy, startTemplateTransition] = useTransition();

  // Fill the form's trip fields — everything except the dates, which the
  // requester still picks. Uncontrolled inputs are set on the DOM; the few
  // controlled fields go through their setters. Shared by saved templates and
  // the "book again" prefill.
  const applyFields = (tpl: BookingPrefill) => {
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
    set("googleMapsUrl", tpl.googleMapsUrl);
    set("pickupLocation", tpl.pickupLocation);
    setPickupReturnTime(tpl.pickupReturnTime ?? "");
    set("waitingLocation", tpl.waitingLocation);
    set("ajarnName", tpl.ajarnName);
    set("ajarnPhone", tpl.ajarnPhone);
    set("ajarnEmail", tpl.ajarnEmail);
    set("coordinatorName", tpl.coordinatorName);
    set("coordinatorPhone", tpl.coordinatorPhone);
    set("maleCount", tpl.maleCount);
    set("femaleCount", tpl.femaleCount);
    set("passengerNotes", tpl.passengerNotes);
    setPassengerCount(String(tpl.passengerCount ?? 1));
    // Trip area folds the old within-Chula / out-of-province booleans into one
    // three-way choice. Overnight is date-related, so it resets on apply.
    selectTripArea(
      tpl.travelWithinChula ? "WITHIN_CHULA" : tpl.outOfProvince ? "UPCOUNTRY" : "BANGKOK_METRO",
    );
    setIsEmergency(tpl.isEmergency);
    setReturnTrip(tpl.returnTrip);
    setWaitAtDestination(tpl.waitAtDestination);
    setPreferredVehicleType(tpl.preferredVehicleType);
    setNeedsOutsourcing(tpl.needsOutsourcing);
  };

  const applyTemplate = (tpl: TripTemplate) => {
    applyFields(tpl);
    setActiveTemplateId(tpl.id);
    setTemplateMsg(t("templateApplied", { name: tpl.name }));
  };

  // "Book again": apply the source booking's trip fields once on mount. Runs
  // after first render so the uncontrolled inputs exist in the DOM.
  const prefillApplied = useRef(false);
  useEffect(() => {
    if (!prefill || prefillApplied.current) return;
    prefillApplied.current = true;
    applyFields(prefill);
    setTemplateMsg(t("rebookApplied", { job: prefillLabel ?? "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

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
      toastResult(res, { success: tt("templateSaved") });
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
      toastResult(res, { success: tt("templateDeleted") });
      if (res.ok && activeTemplateId === tpl.id) setActiveTemplateId(null);
      setTemplateMsg(res.ok ? null : res.error);
    });
  };

  // The trip area's base lead time (ignoring the urgent waiver) — shown in the
  // area helper text so requesters see "3 / 7 business days" (or "30 days" for
  // external charter) up front.
  const areaLeadDays = isExternalCharter
    ? LEAD_TIME_SMUS_DAYS
    : isUpcountry
      ? LEAD_TIME_OUTSIDE_DAYS
      : LEAD_TIME_BANGKOK_DAYS;
  const requiredDays = isEmergency ? LEAD_TIME_URGENT_DAYS : areaLeadDays;
  // Earliest start = midnight on (today + N days). External charter (SMUS)
  // counts every calendar day, including weekends; the other tiers skip
  // Saturdays and Sundays. Any time on that day is fine.
  const earliestStart = startOfDay(
    isExternalCharter && !isEmergency ? addDays(now, requiredDays) : addBusinessDays(now, requiredDays),
  );
  const minStart = datetimeLocalValue(earliestStart);
  // Cap typed year so the browser can't accept "20251" or longer.
  const maxStart = datetimeLocalValue(addYears(now, 5));

  const [startValue, setStartValue] = useState<string>("");
  const [endValue, setEndValue] = useState<string>("");

  // Earliest allowed end DAY: the start day for a same-day trip, the day AFTER
  // for an overnight (upcountry) trip. Same-day trips are single-day, so the
  // end is pinned to the start day (only the time is chosen). Overnight trips
  // may end on the next day OR any later day — the requester picks it.
  const startDateObj = startValue ? new Date(startValue) : null;
  const startIsValid = !!startDateObj && !Number.isNaN(startDateObj.getTime());
  // One-way: no end is chosen, but the server still wants an endAt > startAt.
  // Send a provisional (start + 3h) — the admin overwrites it at approval.
  const provisionalEndValue = startIsValid
    ? datetimeLocalValue(new Date(startDateObj!.getTime() + 3 * 60 * 60 * 1000))
    : "";
  const minEndDay = startIsValid
    ? isOvernight
      ? addDays(startOfDay(startDateObj!), 1)
      : startOfDay(startDateObj!)
    : null;
  const endMinValue = minEndDay ? datetimeLocalValue(minEndDay) : startValue || minStart;
  // Overnight: open-ended from the next day on. Same-day: cap the max to the
  // start day so the calendar offers only that day (time-only choice).
  const endMaxValue = isOvernight
    ? maxStart
    : minEndDay
      ? datetimeLocalValue(minEndDay)
      : maxStart;

  useEffect(() => {
    if (!minEndDay) return;
    const floor = minEndDay;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- correct the chosen end time when the min-end floor shifts (controlled sync of a derived bound, not fresh state)
    setEndValue((prev) => {
      if (!prev) return prev; // no end time chosen yet — nothing to correct
      const prevDate = new Date(prev);
      if (Number.isNaN(prevDate.getTime())) return prev;
      if (isOvernight) {
        // Overnight: only bump the date up to the floor when it's earlier;
        // the requester may freely keep any later day they picked.
        if (startOfDay(prevDate).getTime() >= floor.getTime()) return prev;
      } else if (isSameDay(prevDate, floor)) {
        return prev; // same-day and already on the start day — compliant
      }
      // Shift the date only; keep whatever time the requester already chose.
      const next = new Date(floor);
      next.setHours(prevDate.getHours(), prevDate.getMinutes(), 0, 0);
      return datetimeLocalValue(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `minEndDay` is a new Date each render; depend on its primitive instead to avoid an infinite loop.
  }, [minEndDay?.getTime(), isOvernight]);

  const handleStartChange = (v: string) => {
    setStartValue(v);
  };

  const handleEndChange = (v: string) => {
    setEndValue(v);
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
  // than a browser-native tooltip.
  const baseRequired: Array<{ name: string; labelKey: string }> = [
    { name: "startAt", labelKey: "startLabel" },
    // endAt is only required for round trips; one-way leaves it to the admin
    // (a provisional value rides along in a hidden field).
    ...(returnTrip ? [{ name: "endAt", labelKey: "endLabel" }] : []),
    { name: "purpose", labelKey: "purpose" },
    { name: "destination", labelKey: "destination" },
    { name: "googleMapsUrl", labelKey: "mapsLinkLabel" },
    { name: "waitingLocation", labelKey: "waitingLocation" },
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

  return (
    <Card>
      <CardContent className="pt-4">
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
            if (!waitAtDestination && (!dropOffTime || !pickupReturnTime)) {
              setError(t("noWaitTimesRequired"));
              document.getElementById("dropOffTime")?.focus();
              return;
            }
            startTransition(async () => {
              const res = await createBookingAction(formData);
              if (res && !res.ok) {
                // The server returns which field failed — point the requester
                // straight at it (and name it), so a terse zod message like
                // "Required" / "Invalid email" isn't a mystery.
                if (res.field) {
                  const labelEntry = baseRequired.find((f) => f.name === res.field);
                  const el = document.getElementById(res.field);
                  el?.scrollIntoView({ block: "center", behavior: "smooth" });
                  (el as HTMLElement | null)?.focus();
                  setError(
                    labelEntry ? `${t(labelEntry.labelKey)}: ${res.error}` : res.error,
                  );
                } else {
                  setError(res.error);
                }
              }
              // success redirects to the booking detail, so only the error path
              // returns here — toastResult fires the error toast (the success arg
              // is a never-reached fallback, kept only to satisfy the signature).
              if (res) toastResult(res, { success: tt("genericError") });
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Bookmark aria-hidden className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">{t("templatesTitle")}</span>
              {templates.length > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
                  {templates.length}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("templatesHelper")}</p>

            {templates.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {templates.map((tpl) => {
                  const active = activeTemplateId === tpl.id;
                  return (
                    <li
                      key={tpl.id}
                      data-active={active}
                      className="group flex items-stretch overflow-hidden rounded-lg border bg-background transition-colors data-[active=true]:border-primary data-[active=true]:bg-primary/5 data-[active=true]:ring-1 data-[active=true]:ring-primary"
                    >
                      <button
                        type="button"
                        onClick={() => applyTemplate(tpl)}
                        aria-pressed={active}
                        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span
                          aria-hidden
                          className={
                            active
                              ? "grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                              : "grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
                          }
                        >
                          {active ? <Check className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{tpl.name}</span>
                        {active && (
                          <span className="shrink-0 text-[11px] font-medium text-primary">
                            {t("templateActiveBadge")}
                          </span>
                        )}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          aria-label={t("templateActions", { name: tpl.name })}
                          className="grid w-9 shrink-0 place-items-center border-l text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => renameTemplate(tpl)}>
                            <Pencil className="h-3.5 w-3.5" />
                            {t("templateRenameAction")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => deleteTemplate(tpl)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t("templateDeleteAction")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
                {t("templatesEmpty")}
              </p>
            )}

            <div className="space-y-2 border-t pt-3">
              <Label htmlFor="templateName" className="text-xs text-muted-foreground">
                {t("templateSaveHeading")}
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="templateName"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={t("templateNamePlaceholder")}
                  aria-label={t("templateNamePlaceholder")}
                  className="h-9 min-w-0 flex-1 sm:flex-none sm:w-72"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={saveTemplate}
                  disabled={templateBusy}
                  className="h-9"
                >
                  <BookmarkPlus aria-hidden className="h-4 w-4" />
                  {t("saveTemplate")}
                </Button>
              </div>
              {templateMsg && (
                <p className="text-xs font-medium text-muted-foreground">{templateMsg}</p>
              )}
            </div>
          </div>

          <fieldset className="space-y-3 rounded-md border bg-muted/30 p-4">
            <legend className="px-1 text-sm font-semibold">{t("scheduleSectionTitle")}</legend>
            {/* Trip area — picked first because it sets the lead time (and so the
                earliest selectable start date) and decides whether overnight is
                offered. รถเวร routing follows the within-Chula choice. */}
            <div className="grid gap-2">
              <Label>{t("tripAreaLabel")}</Label>
              <div
                role="radiogroup"
                aria-label={t("tripAreaLabel")}
                className="grid grid-cols-2 gap-2"
              >
                {TRIP_AREAS.map(({ value, key }) => {
                  const selected = tripArea === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => selectTripArea(value)}
                      className={
                        "rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                        (selected
                          ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                          : "border-input bg-background text-foreground hover:bg-muted/60")
                      }
                    >
                      {t(key)}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {t(
                  TRIP_AREAS.find((a) => a.value === tripArea)?.helperKey ?? "tripAreaBangkokMetroHelper",
                  { days: areaLeadDays },
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-3 sm:gap-4">
              <div className="grid min-w-0 flex-1 gap-2 basis-40">
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
                  overnight={
                    isUpcountry
                      ? {
                          value: overnight,
                          onChange: setOvernight,
                          label: t("overnightLabel"),
                          helper: t("overnightHelper"),
                          warning: t("outOfProvinceLeadWarning", {
                            days: LEAD_TIME_OUTSIDE_DAYS,
                          }),
                          yesLabel: t("overnightYes"),
                          noLabel: t("overnightNo"),
                        }
                      : undefined
                  }
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
              {/* เดินทางกลับ / ไม่เดินทางกลับ (เที่ยวเดียว) — its own compact
                  column, placed in front of (to the left of) the end-date box
                  so start and end stay equal-sized boxes. One-way swaps the
                  end picker for a note — the admin sets the real end time at
                  approval. */}
              <div className="grid w-36 shrink-0 gap-2">
                <Label htmlFor="returnTrip">{t("returnTripLabel")}</Label>
                <select
                  id="returnTrip"
                  value={returnTrip ? "yes" : "no"}
                  onChange={(e) => setReturnTrip(e.target.value === "yes")}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="yes">{t("returnTripYes")}</option>
                  <option value="no">{t("returnTripNo")}</option>
                </select>
              </div>
              <div className="grid min-w-0 flex-1 gap-2 basis-40">
                {returnTrip ? (
                  <ReqLabel htmlFor="endAt">{t("endLabel")}</ReqLabel>
                ) : (
                  <Label htmlFor="endAt">{t("endLabel")}</Label>
                )}
                {returnTrip ? (
                  <DateTimePicker
                    id="endAt"
                    name="endAt"
                    required
                    min={endMinValue}
                    max={endMaxValue}
                    defaultValue={endValue}
                    placeholder={t("endLabel")}
                    onChange={handleEndChange}
                    timeLabel={t("endTimeLabel")}
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
                ) : (
                  <div
                    id="endAt"
                    className="flex h-10 items-center rounded-md border border-dashed bg-muted/30 px-3 text-xs text-muted-foreground"
                  >
                    {t("oneWayNote")}
                  </div>
                )}
              </div>
            </div>
            {returnTrip && endBeforeStart && (
              <p className="text-xs font-medium text-destructive">{t("endBeforeStart")}</p>
            )}
            {returnTrip && startIsValid && !isOvernight && (
              <p className="text-xs text-muted-foreground">{t("endDateAutoSameDay")}</p>
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
            {/* returnTrip rides along ("true"/"" only — z.coerce.boolean treats
                any non-empty string as true). One-way hides the end picker, so
                send a provisional endAt the admin overwrites at approval. */}
            <input type="hidden" name="returnTrip" value={returnTrip ? "true" : ""} />
            {!returnTrip && <input type="hidden" name="endAt" value={provisionalEndValue} />}
            {/* No-wait split: drop-off-done time (leg-1 end). Same calendar day
                as the start; combined into a datetime-local for the hidden field. */}
            {!waitAtDestination && (
              <div className="grid gap-2">
                <ReqLabel htmlFor="dropOffTime">{t("dropOffDoneLabel")}</ReqLabel>
                <input
                  id="dropOffTime"
                  type="time"
                  step={900}
                  value={dropOffTime}
                  onChange={(e) => setDropOffTime(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="text-xs text-muted-foreground">{t("dropOffDoneHelper")}</span>
              </div>
            )}
            <input
              type="hidden"
              name="dropOffDone"
              value={
                !waitAtDestination && dropOffTime && startValue
                  ? `${startValue.slice(0, 10)}T${dropOffTime}`
                  : ""
              }
            />

            {/* Prominent disclosure: a bordered card with a primary-tinted
                icon so recurring bookings are easy to find and act on. */}
            <details className="group rounded-md border border-border bg-card shadow-sm">
              <summary className="flex cursor-pointer select-none items-center gap-2.5 p-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Repeat aria-hidden className="h-4 w-4" />
                </span>
                <span>{t("recurringSummary")}</span>
                <ChevronDown
                  aria-hidden
                  className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="space-y-3 border-t border-border/60 p-3">
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
            {/* Google Maps link is required server-side (origin/main): the
                dispatcher relies on a precise pin, not just a typed place name. */}
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
            </div>
            {waitAtDestination && (
              <div className="grid gap-2">
                <ReqLabel htmlFor="waitingLocation">{t("waitingLocation")}</ReqLabel>
                <Input
                  id="waitingLocation"
                  name="waitingLocation"
                  required
                  placeholder={t("waitingLocationPlaceholder")}
                />
              </div>
            )}
            {/* province / outOfProvince / travelWithinChula are all derived from
                the single Trip-area choice at the top of the schedule section
                and ride along as hidden fields. The booleans must emit "true"/""
                — never "false" — because z.coerce.boolean treats any non-empty
                string as true. */}
            <input
              type="hidden"
              name="province"
              value={isUpcountry ? "ต่างจังหวัด" : BANGKOK_PROVINCE}
            />
            <input type="hidden" name="outOfProvince" value={isUpcountry ? "true" : ""} />
            <input type="hidden" name="travelWithinChula" value={isWithinChula ? "true" : ""} />
            {/* External charter forces jobType=SMUS so the server skips internal
                vehicle/driver/slot allocation; other areas leave it unset and
                let the classifier derive it. */}
            {isExternalCharter && <input type="hidden" name="jobType" value="SMUS" />}
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
                <Input
                  id="maleCount"
                  name="maleCount"
                  type="number"
                  min={0}
                  placeholder="0"
                  className="h-10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="femaleCount">{t("femaleCount")}</Label>
                <Input
                  id="femaleCount"
                  name="femaleCount"
                  type="number"
                  min={0}
                  placeholder="0"
                  className="h-10"
                />
              </div>
            </div>
            {isExternalCharter ? (
              // External charter: specify how many outside buses/vans instead of
              // picking an internal vehicle category.
              <div className="grid gap-2">
                <Label>{t("externalVehicleCounts")}</Label>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="grid gap-2 min-w-0">
                    <Label htmlFor="externalBusCount" className="text-xs text-muted-foreground">
                      {t("externalBusCount")}
                    </Label>
                    <Input
                      id="externalBusCount"
                      name="externalBusCount"
                      type="number"
                      min={0}
                      max={99}
                      value={externalBusCount}
                      onChange={(e) => setExternalBusCount(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2 min-w-0">
                    <Label htmlFor="externalVanCount" className="text-xs text-muted-foreground">
                      {t("externalVanCount")}
                    </Label>
                    <Input
                      id="externalVanCount"
                      name="externalVanCount"
                      type="number"
                      min={0}
                      max={99}
                      value={externalVanCount}
                      onChange={(e) => setExternalVanCount(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{t("externalVehicleHelper")}</p>
                {/* External charter is always an outside rental. */}
                <input type="hidden" name="needsOutsourcing" value="true" />
              </div>
            ) : (
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
                <p className="text-xs text-muted-foreground">{t("flagOutsourcingDenyNotice")}</p>
                <input
                  type="hidden"
                  name="needsOutsourcing"
                  value={isBus || needsOutsourcing ? "true" : ""}
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="passengerNotes">{t("passengerNotes")}</Label>
              <Textarea id="passengerNotes" name="passengerNotes" rows={3} />
              {/* Optional supporting file (memo, invitation letter, etc.) to
                  back up the note above — uploaded alongside the booking. */}
              <input
                ref={attachmentInputRef}
                id="attachment"
                name="attachment"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(e) => setAttachmentName(e.target.files?.[0]?.name ?? null)}
              />
              {attachmentName ? (
                <div className="flex w-fit items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs">
                  <Paperclip aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="max-w-[14rem] truncate">{attachmentName}</span>
                  <button
                    type="button"
                    aria-label={t("attachmentRemove")}
                    onClick={() => {
                      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
                      setAttachmentName(null);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <Paperclip aria-hidden className="h-3.5 w-3.5" />
                  {t("attachmentAdd")}
                </button>
              )}
              <p className="text-xs text-muted-foreground">{t("attachmentHelper")}</p>
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
