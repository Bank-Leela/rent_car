"use client";

import { useTranslations } from "next-intl";
import { DENY_PRESET_KEYS } from "@/lib/booking/deny-presets";

// One-tap canned deny reasons. Clicking a chip fills the reason box (still
// editable). Shared by the inline queue deny and the detail-page deny form.
export function DenyPresetChips({ onPick }: { onPick: (text: string) => void }) {
  const t = useTranslations("approverActions");
  return (
    <div className="flex flex-wrap gap-1.5">
      {DENY_PRESET_KEYS.map((key) => {
        const text = t(`denyPresets.${key}`);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(text)}
            className="rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}
