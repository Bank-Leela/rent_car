"use client";

import * as React from "react";
import { Upload, FileCheck2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * A file field that looks like the rest of the app.
 *
 * `<input type="file">` renders OS chrome: a grey "Choose File" button and the
 * words "No file chosen", in ENGLISH regardless of locale, at the browser's own
 * height. On a Thai, dark, 44px-field form it is the one control that plainly
 * belongs to a different program — and it cannot be restyled, only replaced.
 *
 * The replacement is not invented here: booking-form.tsx already hides its
 * attachment input and draws its own chip with the filename. This is that
 * pattern as a primitive, so the other two file fields stop being the odd ones
 * out.
 *
 * One deliberate difference from booking-form's version, which uses
 * `className="hidden"`: display:none makes a control unfocusable, and the
 * browser cannot focus or scroll to a hidden field that fails `required`. Here
 * the real input is kept in the layout, stretched over the visible control at
 * opacity 0. So it still takes focus, still opens the picker on click or Enter,
 * and — because its bounding box is exactly the box you can see — the app's
 * validation bubble anchors under the right thing.
 */
export function FileInput({
  className,
  onChange,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const t = useTranslations("common");
  const [name, setName] = React.useState<string | null>(null);

  return (
    <div className={cn("relative", className)}>
      <input
        type="file"
        onChange={(e) => {
          setName(e.target.files?.[0]?.name ?? null);
          onChange?.(e);
        }}
        // `peer` so the visible box below can wear the focus ring; the input
        // itself is invisible but is what actually receives focus.
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <div
        aria-hidden
        className="flex h-11 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-3 text-sm transition-colors peer-hover:bg-muted/50 peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-disabled:opacity-50 peer-aria-invalid:border-destructive dark:bg-input/30"
      >
        {name ? (
          <FileCheck2 className="h-4 w-4 shrink-0 text-primary" />
        ) : (
          <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("truncate", name ? "text-foreground" : "text-muted-foreground")}>
          {name ?? t("chooseFile")}
        </span>
      </div>
    </div>
  );
}
