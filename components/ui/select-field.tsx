"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SelectFieldOption = { value: string; label: React.ReactNode; disabled?: boolean };

// Themed dropdown that matches the app's design system — replaces native <select>
// (whose open option list is OS-rendered and can't be styled). Form-friendly:
// pass `name` and it submits via base-ui's hidden input, exactly like a <select>.
export function SelectField({
  options,
  name,
  id,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  required,
  disabled,
  className,
  contentClassName,
  "aria-label": ariaLabel,
}: {
  options: SelectFieldOption[];
  name?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  "aria-label"?: string;
}) {
  // value -> label map so the trigger shows the selected option's label.
  const items = React.useMemo(
    () => Object.fromEntries(options.map((o) => [o.value, o.label])) as Record<string, React.ReactNode>,
    [options],
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
      {/* min-w-0 + overflow-hidden: the trigger is `w-fit whitespace-nowrap`,
          so without these a value longer than the field spills out of the box
          and over whatever sits beside it. */}
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn("w-full min-w-0 overflow-hidden", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
