import type { LucideIcon } from "lucide-react";

/**
 * The page's opening surface: a deep indigo band with the title on it.
 *
 * Both references the user pointed at open with a large, saturated, full-bleed
 * area — Agoda a photograph with a card floating over it, Apple a product on a
 * gradient. This app went from a hairline header straight onto flat ground, and
 * that is most of what read as "empty and plain" at first glance: nothing on the
 * page had any presence.
 *
 * Built entirely in CSS. There is no photography in the repo (`public/` holds
 * Next's default SVGs and one PDF), the network is off, and a hospital faculty's
 * internal tool has no business shipping stock travel imagery anyway. The
 * texture is three layers: a diagonal indigo base, two soft radial highlights,
 * and a faint dot grid — enough to read as a surface rather than a flat fill.
 *
 * NOT a return of the radial wash removed earlier. That was ambient gradient
 * sprayed behind page content, which lifted the ground unevenly and stopped
 * cards reading as raised. This is a bounded, opaque surface that content sits
 * ON TOP OF, which is the opposite relationship: it gives the cards below
 * something to be in front of.
 */
export function HeroBand({
  title,
  description,
  icon: Icon,
  stats,
  actions,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Small facts about what the page is showing — Agoda's count chips. */
  stats?: { label: string; value: string | number; tone?: "default" | "urgent" | "good" }[];
  actions?: React.ReactNode;
}) {
  return (
    // -mt-8 cancels <main>'s top padding so the band TOUCHES the bar. With a gap
    // it read as a floating panel that happened to be blue; flush, and starting
    // from the bar's exact colour, the two are one surface that the page hangs
    // from — which is the whole point of the reference.
    // -mx to the edges of the content column, rounded at the bottom only.
    <div className="relative -mx-4 -mt-8 overflow-hidden rounded-b-2xl sm:-mx-6 lg:-mx-8">
      {/* Layer 1 — the base. Diagonal rather than vertical so the band has a
          direction; a vertical fade on a short band just looks like a shadow.
          All three stops stay inside hue 250–272, i.e. the indigo/blue family the
          palette is already built on. The first version ran to hue 286 and the
          result was a violet-to-blue sweep — which is both a drift off the
          project's settled indigo and the single most recognisable
          generated-by-a-prompt gradient there is. A booking product's hero blue
          is a product blue. */}
      {/* First stop is var(--bar) exactly, so the join with the header above is
          invisible and the band reads as the bar continuing downward. */}
      <div className="absolute inset-0 bg-[linear-gradient(112deg,var(--bar)_0%,oklch(0.41_0.16_268)_48%,oklch(0.34_0.14_252)_100%)]" />
      {/* Layer 2 — two soft highlights, offset so the light has a source. The
          second is a cool cyan rather than magenta: it reads as depth in the same
          family instead of introducing a second hue nothing else in the app uses. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_140%_at_10%_-15%,oklch(0.74_0.15_252/0.5)_0%,transparent_58%),radial-gradient(95%_130%_at_95%_120%,oklch(0.62_0.12_215/0.34)_0%,transparent_62%)]" />
      {/* Layer 3 — a dot grid at 1.5 % opacity. Invisible as a pattern, but it
          stops the gradient looking like a plastic fill. currentColor-free and
          inline so no request leaves the page. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "radial-gradient(oklch(1 0 0 / 0.35) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />
      {/* A hairline of light along the top edge — the same trick the dark-theme
          elevation uses, and what makes the band read as a lit surface. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/15" />

      <div className="relative px-4 pb-7 pt-8 sm:px-6 sm:pb-8 sm:pt-10 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              {Icon && (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 text-white ring-1 ring-inset ring-white/20">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
              )}
              {/* Pure white, not white/90: this sits on a saturated indigo and
                  Thai script has fine strokes that grey out fast. */}
              <h1 className="min-w-0 text-[1.75rem] font-semibold leading-[1.2] tracking-[-0.02em] text-white sm:text-[2.125rem]">
                {title}
              </h1>
            </div>
            {description && (
              // white/75 clears 4.5:1 on this base; anything lighter in weight
              // or opacity does not.
              <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-white/75">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>

        {/* Count chips. Agoda's move: say how much is here before the user
            scrolls, so the page announces its own size. Only rendered when the
            page actually has numbers worth stating. */}
        {stats && stats.length > 0 && (
          <dl className="mt-6 flex flex-wrap gap-2">
            {stats.map((s) => (
              <div
                key={s.label}
                className={`flex items-baseline gap-1.5 rounded-full px-3 py-1.5 ring-1 ring-inset backdrop-blur-sm ${
                  s.tone === "urgent"
                    ? "bg-amber-300/20 ring-amber-200/40"
                    : s.tone === "good"
                      ? "bg-emerald-300/20 ring-emerald-200/40"
                      : "bg-white/12 ring-white/20"
                }`}
              >
                <dd className="text-sm font-semibold tabular-nums text-white">{s.value}</dd>
                <dt className="text-xs text-white/70">{s.label}</dt>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
