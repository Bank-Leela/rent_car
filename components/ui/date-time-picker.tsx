"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parse,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { th, enUS, type Locale } from "date-fns/locale";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Clock, Undo2 } from "lucide-react";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { isThaiLocale } from "@/i18n/config";

interface DateTimePickerProps {
  name: string;
  defaultValue?: string; // yyyy-MM-ddTHH:mm
  min?: string;
  max?: string;
  required?: boolean;
  id?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  // Date-only mode: hide the time controls and emit/display `yyyy-MM-dd`
  // instead of `yyyy-MM-ddTHH:mm`. Used for fields like the recurrence
  // "repeat until" date where time is meaningless.
  dateOnly?: boolean;
  // Overrides the default "เวลา / Time" label on the time-of-day control.
  // Used by the End picker to read "เวลาที่ถึงคณะ" so it isn't confused with
  // pickupReturn.pickupTimeLabel (the driver's separate return time).
  timeLabel?: string;
  // Optional "out-of-province overnight" Yes/No toggle rendered inside the
  // popover. When `value` is true and the currently selected day falls before
  // `min` (the longer lead-time window), the Done button is disabled and
  // `warning` is shown — the trip must be booked further ahead. The toggle
  // state itself is owned by the parent form (it also drives lead time,
  // the province field, and the lead-time notice).
  overnight?: {
    value: boolean;
    onChange: (next: boolean) => void;
    label: string;
    helper: string;
    warning: string;
    yesLabel: string;
    noLabel: string;
  };
  // Optional "urgent booking" Yes/No toggle, also rendered inside the popover.
  // Turning it on waives the lead-time floor (the parent shortens `min`), so
  // there is no warning/block here — it only relaxes the rules.
  urgent?: {
    value: boolean;
    onChange: (next: boolean) => void;
    label: string;
    helper: string;
    yesLabel: string;
    noLabel: string;
  };
  // Optional คอย/ไม่คอย (wait-at-destination) toggle, rendered inside the
  // popover — belongs on the End picker since it's about what happens before
  // the return trip. When `wait` is false, a plain time input for the
  // driver's pickup-return time appears underneath.
  pickupReturn?: {
    wait: boolean;
    onWaitChange: (next: boolean) => void;
    pickupTime: string; // "HH:mm" or ""
    onPickupTimeChange: (next: string) => void;
    label: string;
    helper: string;
    waitYesLabel: string;
    waitNoLabel: string;
    pickupTimeLabel: string;
  };
}

const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_TH = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] as const;

function toLocalISO(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseValue(v: string | undefined): Date | null {
  if (!v) return null;
  try {
    return parse(v, "yyyy-MM-dd'T'HH:mm", new Date());
  } catch {
    return null;
  }
}

export function DateTimePicker({
  name,
  defaultValue,
  min,
  max,
  required,
  id,
  placeholder,
  onChange,
  dateOnly,
  timeLabel,
  overnight,
  urgent,
  pickupReturn,
}: DateTimePickerProps) {
  const locale = useLocale();
  const dfLocale: Locale = isThaiLocale(locale) ? th : enUS;
  const initial = parseValue(defaultValue);
  const [value, setValue] = useState<Date | null>(initial);
  const [viewMonth, setViewMonth] = useState<Date>(initial ?? new Date());
  const [open, setOpen] = useState(false);
  // Flip the popover above the trigger when there isn't room below (e.g. the
  // recurrence field near the bottom of the form) so it never opens off-screen.
  const [dropUp, setDropUp] = useState(false);
  // Horizontal correction applied AFTER the panel is on screen and can be
  // measured. This replaced a hard-coded width estimate: the panel's real width
  // depends on which extras it carries (the End picker's คอย/ไม่คอย column with
  // its helper paragraph is far wider than the plain calendar), so any constant
  // is wrong for some variant and the panel silently hangs off the screen.
  const [shiftX, setShiftX] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [hour, setHour] = useState<number>(initial?.getHours() ?? 8);
  const [minute, setMinute] = useState<number>(initial?.getMinutes() ?? 0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Sync from controlled defaultValue when the parent mutates it (e.g.
  // a "fill earliest" button setting a date externally). Without this the
  // picker would still show the previous internal state.
  useEffect(() => {
    const parsed = parseValue(defaultValue);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync of internal state to a controlled defaultValue change
    setValue(parsed);
    if (parsed) {
      setHour(parsed.getHours());
      setMinute(parsed.getMinutes());
      setViewMonth(parsed);
    }
  }, [defaultValue]);

  const minDate = parseValue(min);
  const maxDate = parseValue(max);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth));
    const end = endOfWeek(endOfMonth(viewMonth));
    return eachDayOfInterval({ start, end });
  }, [viewMonth]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function commit(day: Date, h: number, m: number) {
    const next = new Date(day);
    next.setHours(dateOnly ? 0 : h, dateOnly ? 0 : m, 0, 0);
    setValue(next);
    onChange?.(dateOnly ? format(next, "yyyy-MM-dd") : toLocalISO(next));
  }

  function pickDay(day: Date) {
    commit(day, hour, minute);
    if (dateOnly) setOpen(false);
  }

  function changeHour(h: number) {
    const v = Math.max(0, Math.min(23, h));
    setHour(v);
    if (value) commit(value, v, minute);
  }
  function changeMinute(m: number) {
    const v = Math.max(0, Math.min(59, m));
    setMinute(v);
    if (value) commit(value, hour, v);
  }

  // Measure the panel and slide it horizontally so it always sits inside the
  // viewport: pull it left when it overruns the right edge, right when it would
  // overrun the left. Runs before paint, so the user never sees the unclamped
  // position. shiftX is 0 while measuring because it resets on close.
  useLayoutEffect(() => {
    // No reset on close: the panel unmounts, and on the next open React renders
    // with the previous shift still applied, which `clamp` subtracts back out
    // before measuring. Calling setState here would only cascade a render.
    if (!open) return;
    const clamp = () => {
      const el = panelRef.current;
      if (!el) return;
      const MARGIN = 12;
      const r = el.getBoundingClientRect();
      // r already includes the current shift, so undo it to get the natural box.
      const left = r.left - shiftX;
      const right = r.right - shiftX;
      let dx = 0;
      if (right > window.innerWidth - MARGIN) dx = window.innerWidth - MARGIN - right;
      if (left + dx < MARGIN) dx = MARGIN - left;
      setShiftX(dx);
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleOpen() {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      // ~380px ≈ popover height; flip up only when below is tight and there's
      // more room above.
      setDropUp(below < 380 && rect.top > below);
    }
    setOpen((v) => !v);
  }

  const hiddenValue = value ? (dateOnly ? format(value, "yyyy-MM-dd") : toLocalISO(value)) : "";
  const display = value
    ? format(value, dateOnly ? "EEE d MMM yyyy" : "EEE d MMM yyyy · HH:mm", { locale: dfLocale })
    : placeholder ?? "";

  function isDisabled(day: Date): boolean {
    if (minDate && day < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())) return true;
    if (maxDate && day > new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())) return true;
    return false;
  }

  // Block "Done" when an overnight out-of-province trip is selected but the
  // chosen day sits before the (longer) lead-time floor. This checks `min`
  // ONLY — not `isDisabled`, which also folds in the `max` bound (the end
  // date), and would wrongly fire on a same-day max once the value carries a
  // time of day.
  const beforeMinDay =
    value != null &&
    minDate != null &&
    value < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
  const overnightBlocked = !!overnight?.value && beforeMinDay;

  // The left column (time + overnight + urgent) only exists when there's
  // something to put in it. dateOnly pickers with no toggles render the
  // calendar alone.
  const hasExtras = !dateOnly || !!overnight || !!urgent || !!pickupReturn;

  // Parse the pickup-return time ("HH:mm") into editable hour/minute parts so
  // it can reuse the same two-box number inputs as the arrival time instead of
  // a native <input type="time">. Stays empty until the requester types.
  const prMatch = pickupReturn
    ? /^(\d{1,2}):(\d{1,2})$/.exec(pickupReturn.pickupTime || "")
    : null;
  const prHour = prMatch ? Number(prMatch[1]) : null;
  const prMinute = prMatch ? Number(prMatch[2]) : null;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const commitPickup = (h: number | null, m: number | null) => {
    const hh = Math.max(0, Math.min(23, Number.isFinite(h) ? (h as number) : 0));
    const mm = Math.max(0, Math.min(59, Number.isFinite(m) ? (m as number) : 0));
    pickupReturn?.onPickupTimeChange(`${pad2(hh)}:${pad2(mm)}`);
  };

  return (
    <div ref={rootRef} className="relative">
      <input type="hidden" name={name} value={hiddenValue} required={required} />
      <button
        type="button"
        id={id}
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className={cn("truncate text-left", !value && "text-muted-foreground")}>
          {display}
        </span>
        <Calendar className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          ref={panelRef}
          style={shiftX ? { transform: `translateX(${shiftX}px)` } : undefined}
          className={cn(
            "absolute left-0 z-50 w-auto max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl",
            dropUp ? "bottom-full mb-2" : "mt-2",
          )}
        >
          {/* Wraps rather than forcing one row: on a narrow window the extras
              column drops under the calendar instead of pushing the panel wider
              than the screen. */}
          <div className="flex flex-wrap gap-4">
            {/* Time + overnight + urgent (only when present). Rendered after
                the calendar in markup but visually placed on the LEFT via
                `order-2`/`order-1` below, so the calendar reads first. */}
            {hasExtras && (
              <div className="order-2 flex w-56 shrink-0 flex-col gap-3">
                {/* On the End picker (pickupReturn present), the time control
                    represents the arrival time at the faculty, not the
                    driver's return time — render it below the wait toggle so
                    it reads as "after deciding whether the car waits". On the
                    Start picker it stays in its original top position. */}
                {!dateOnly && !pickupReturn && (
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      <span>{timeLabel ?? "เวลา / Time"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={String(hour).padStart(2, "0")}
                        onChange={(e) => changeHour(Number(e.target.value))}
                        className="h-9 w-14 rounded-md border border-input bg-background px-2 text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label="ชั่วโมง"
                      />
                      <span className="text-base font-bold text-muted-foreground">:</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={String(minute).padStart(2, "0")}
                        onChange={(e) => changeMinute(Number(e.target.value))}
                        className="h-9 w-14 rounded-md border border-input bg-background px-2 text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label="นาที"
                      />
                    </div>
                  </div>
                )}

                {overnight && (
                  <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                    <span className="block text-xs font-medium">{overnight.label}</span>
                    <div className="inline-flex rounded-md border border-input p-0.5">
                      <button
                        type="button"
                        onClick={() => overnight.onChange(false)}
                        aria-pressed={!overnight.value}
                        className={cn(
                          "rounded px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          !overnight.value
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {overnight.noLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => overnight.onChange(true)}
                        aria-pressed={overnight.value}
                        className={cn(
                          "rounded px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          overnight.value
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {overnight.yesLabel}
                      </button>
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">{overnight.helper}</p>
                    {overnightBlocked && (
                      <p className="text-[11px] font-medium leading-snug text-destructive">
                        {overnight.warning}
                      </p>
                    )}
                  </div>
                )}

                {/* Urgent is an exception, not a routine choice — kept
                    deliberately low-key (collapsed, muted colors) so it isn't
                    mistaken for a normal option and clicked out of habit. A
                    plain chevron marks it as expandable. */}
                {urgent && (
                  <details className="group">
                    <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                      <span>{urgent.label}</span>
                      <ChevronDown
                        aria-hidden
                        className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                      <p className="text-[11px] leading-snug text-muted-foreground">{urgent.helper}</p>
                      <div className="inline-flex rounded-md border border-input p-0.5">
                        <button
                          type="button"
                          onClick={() => urgent.onChange(false)}
                          aria-pressed={!urgent.value}
                          className={cn(
                            "rounded px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            !urgent.value
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {urgent.noLabel}
                        </button>
                        <button
                          type="button"
                          onClick={() => urgent.onChange(true)}
                          aria-pressed={urgent.value}
                          className={cn(
                            "rounded px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            urgent.value
                              ? "bg-muted-foreground/70 text-background shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {urgent.yesLabel}
                        </button>
                      </div>
                    </div>
                  </details>
                )}

                {pickupReturn && (
                  <div className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                    <span className="block text-xs font-medium">{pickupReturn.label}</span>
                    <div className="inline-flex rounded-md border border-input p-0.5">
                      <button
                        type="button"
                        onClick={() => pickupReturn.onWaitChange(false)}
                        aria-pressed={!pickupReturn.wait}
                        className={cn(
                          "rounded px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          !pickupReturn.wait
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {pickupReturn.waitNoLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => pickupReturn.onWaitChange(true)}
                        aria-pressed={pickupReturn.wait}
                        className={cn(
                          "rounded px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          pickupReturn.wait
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {pickupReturn.waitYesLabel}
                      </button>
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">{pickupReturn.helper}</p>
                    {!pickupReturn.wait && (
                      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                        <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Undo2 className="h-3.5 w-3.5" aria-hidden />
                          <span>{pickupReturn.pickupTimeLabel}</span>
                        </span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={23}
                            placeholder="00"
                            value={prHour == null ? "" : pad2(prHour)}
                            onChange={(e) =>
                              commitPickup(
                                e.target.value === "" ? 0 : Number(e.target.value),
                                prMinute,
                              )
                            }
                            className="h-9 w-14 rounded-md border border-input bg-background px-2 text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                            aria-label="ชั่วโมงที่กลับมารับ"
                          />
                          <span className="text-base font-bold text-muted-foreground">:</span>
                          <input
                            type="number"
                            min={0}
                            max={59}
                            placeholder="00"
                            value={prMinute == null ? "" : pad2(prMinute)}
                            onChange={(e) =>
                              commitPickup(
                                prHour,
                                e.target.value === "" ? 0 : Number(e.target.value),
                              )
                            }
                            className="h-9 w-14 rounded-md border border-input bg-background px-2 text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                            aria-label="นาทีที่กลับมารับ"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!dateOnly && pickupReturn && (
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      <span>{timeLabel ?? "เวลา / Time"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={String(hour).padStart(2, "0")}
                        onChange={(e) => changeHour(Number(e.target.value))}
                        className="h-9 w-14 rounded-md border border-input bg-background px-2 text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label="ชั่วโมง"
                      />
                      <span className="text-base font-bold text-muted-foreground">:</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={String(minute).padStart(2, "0")}
                        onChange={(e) => changeMinute(Number(e.target.value))}
                        className="h-9 w-14 rounded-md border border-input bg-background px-2 text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                        aria-label="นาที"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* The calendar — visually LEFT (order-1). */}
            <div className="order-1 w-64 shrink-0">
              <div className="flex items-center justify-between pb-3">
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => subMonths(m, 1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="เดือนก่อนหน้า"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-sm font-semibold">
                  {format(viewMonth, "MMMM yyyy", { locale: dfLocale })}
                </div>
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="เดือนถัดไป"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {(isThaiLocale(locale) ? WEEKDAYS_TH : WEEKDAYS_EN).map((w, i) => (
                  <div key={i} className="py-1">{w}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {days.map((d) => {
                  const inMonth = isSameMonth(d, viewMonth);
                  const selected = value && isSameDay(d, value);
                  const today = isSameDay(d, new Date());
                  const disabled = isDisabled(d);
                  return (
                    <button
                      key={d.toISOString()}
                      type="button"
                      disabled={disabled}
                      onClick={() => pickDay(d)}
                      aria-pressed={!!selected}
                      className={cn(
                        "relative h-9 rounded-md text-sm tabular-nums transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        inMonth ? "text-foreground" : "text-muted-foreground/40",
                        disabled && "cursor-not-allowed opacity-30",
                        selected && "bg-primary text-primary-foreground font-semibold shadow-sm",
                        !selected && !disabled && "hover:bg-accent hover:text-accent-foreground",
                        today && !selected && "ring-1 ring-primary/40",
                      )}
                    >
                      {format(d, "d")}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setValue(null);
                onChange?.("");
              }}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              ล้าง / Clear
            </button>
            <button
              type="button"
              disabled={overnightBlocked}
              onClick={() => setOpen(false)}
              className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40"
            >
              ตกลง / Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
