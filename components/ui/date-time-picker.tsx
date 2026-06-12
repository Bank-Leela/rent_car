"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { Calendar, ChevronLeft, ChevronRight, Clock } from "lucide-react";
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
          className={cn(
            "absolute z-50 w-88 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl",
            dropUp ? "bottom-full mb-2" : "mt-2",
          )}
        >
          <div className="flex items-center justify-between pb-3">
            <button
              type="button"
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Previous month"
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
              aria-label="Next month"
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

          {!dateOnly && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                <span>เวลา / Time</span>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={String(hour).padStart(2, "0")}
                  onChange={(e) => changeHour(Number(e.target.value))}
                  className="h-9 w-14 rounded-md border border-input bg-background px-2 text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Hour"
                />
                <span className="text-base font-bold text-muted-foreground">:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={String(minute).padStart(2, "0")}
                  onChange={(e) => changeMinute(Number(e.target.value))}
                  className="h-9 w-14 rounded-md border border-input bg-background px-2 text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Minute"
                />
              </div>
            </div>
          )}

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
              onClick={() => setOpen(false)}
              className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              ตกลง / Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
