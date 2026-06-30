"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

// Interactive 1–5 star picker (Google-review style). Posts via a hidden input
// named `name`; controlled value via onChange. Keyboard: each star is a radio.
export function StarRatingInput({
  name,
  value,
  onChange,
  label,
}: {
  name: string;
  value: number;
  onChange: (n: number) => void;
  label?: string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-1">
      <input type="hidden" name={name} value={value || ""} />
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={String(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
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
// rounded; show the numeric beside it for precision.
export function StarRatingDisplay({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const px = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const rounded = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} / 5`}>
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
