"use client";

import * as React from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// 15-minute slots across a 24h day ("00:00" … "23:45"). The fleet books on a
// quarter-hour grid (this replaces the old native <input type="time" step={900}>),
// so the menu only ever offers legal values — no free-typing a 09:07. Themed via
// the app's Select primitive, so it matches the jobType dropdown beside it and is
// dark-mode correct, unlike the native time control's OS-rendered spinner.
function buildSlots(stepMinutes: number): string[] {
  const slots: string[] = [];
  for (let m = 0; m < 24 * 60; m += stepMinutes) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    slots.push(`${hh}:${mm}`);
  }
  return slots;
}

export function TimeField({
  name,
  id,
  defaultValue,
  value,
  onValueChange,
  required,
  disabled,
  stepMinutes = 15,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  name?: string;
  id?: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  stepMinutes?: number;
  placeholder?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const slots = React.useMemo(() => buildSlots(stepMinutes), [stepMinutes]);
  // Value→label map (label is the slot itself) so the trigger shows the picked
  // time even before the popup mounts — same contract as SelectField.
  const items = React.useMemo(
    () => Object.fromEntries(slots.map((s) => [s, s])) as Record<string, string>,
    [slots],
  );
  return (
    <Select
      name={name}
      items={items}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange ? (v) => onValueChange(String(v ?? "")) : undefined}
      required={required}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn("w-full", className)}>
        <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {slots.map((s) => (
          <SelectItem key={s} value={s}>
            <span className="tabular-nums">{s}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
