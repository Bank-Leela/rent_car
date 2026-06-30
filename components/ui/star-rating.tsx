"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

// Interactive 1–5 star picker (Google-review style). Five plain buttons (each
// keyboard-operable: Tab + Enter/Space), NOT an ARIA radiogroup — so no
// arrow-key contract is implied. Posts via a hidden input named `name`.
// `starLabel(n)` provides a localized accessible label per star.
export function StarRatingInput({
  name,
  value,
  onChange,
  label,
  starLabel,
}: {
  name: string;
  value: number;
  onChange: (n: number) => void;
  label?: string;
  starLabel?: (n: number) => string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div aria-label={label} className="inline-flex items-center gap-1">
      <input type="hidden" name={name} value={value || ""} />
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          aria-label={starLabel ? starLabel(n) : String(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Star
            className={cn(
              "h-8 w-8 transition-colors",
              n <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
            )}
            aria-hidden
          />
        </button>
      ))}
    </div>
  );
}

// Read-only star display. `value` may be fractional (an average) — stars are
// rounded; the accessible label uses the same one-decimal figure shown on screen.
export function StarRatingDisplay({
  value,
  size = "md",
  label,
}: {
  value: number;
  size?: "sm" | "md";
  label?: string;
}) {
  const px = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const rounded = Math.round(value);
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={label ?? `${value.toFixed(1)} / 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(px, n <= rounded ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")}
          aria-hidden
        />
      ))}
    </span>
  );
}
