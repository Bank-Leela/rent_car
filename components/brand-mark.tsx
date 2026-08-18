/**
 * The product's mark.
 *
 * It was `<Car />` from lucide in a plain tile — a stock icon any of a thousand
 * apps could be using, which is no identity at all. This is drawn for this
 * product: a van in profile, the shape of the vehicles this faculty actually
 * dispatches, sitting on two wheels.
 *
 * Constraints it is drawn to:
 *  - Legible at 24px, the size it is nearly always seen at — the bar tile.
 *    Everything is on a 24 grid with 2px strokes and no detail smaller than
 *    2px. The wheels are open circles rather than dots because a ring survives
 *    downsampling where a filled dot fills in.
 *  - Asymmetric. A vehicle drawn head-on is bilaterally symmetric, and at
 *    display size the eye reads symmetry as a FACE — see the note below.
 *  - Monochrome, `currentColor`. It sits on the indigo bar, on a white login
 *    card and on a dark one, so it cannot carry its own colour.
 *  - No external asset. The repo has no image pipeline and the CSP blocks
 *    remote hosts, so it is inline SVG.
 */
export function BrandMark({
  className,
  title,
}: {
  className?: string;
  /** Give it a title only where it is the sole naming of the product. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {/* A van in profile: one body outline with a stepped bonnet, a chassis
          line broken where the wheels sit, and two wheels.

          Two earlier marks were rejected here, and both failed the same way —
          they were not legible AS a vehicle at 18px. The first was a car seen
          head-on; at 160px its arch, bar and two dots read as a FACE, and by
          28px it was a blob. The second abandoned the vehicle entirely for a
          road in perspective, two converging edges and a dashed centre line —
          which at 18px is three strokes meeting at a point and reads as "/|\"
          or a capital A, not as anything to do with transport.

          A profile silhouette is what survives: it is the shape every road
          sign, parking sign and map app uses for a vehicle, it is asymmetric so
          it cannot collapse into a face, and its two wheels give the eye
          something round to hold on to at any size. Rendered at 18, 28, 48 and
          128px side by side against the other candidates, this was the only one
          still unmistakably a vehicle in the bar. */}
      {/* Drawn to centre on the 24 grid: ink spans x 3–21 and y 6.5–17.5 (the
          wheels' lowest point), so both midpoints land on 12. An earlier cut
          measured 12.65 vertically — it hung 0.65 units low, which is half a
          pixel in the bar and nothing you would catch there, but the tile is
          also rendered at 48px on the login card and blown up in review, and at
          that size a 2.7% drop reads as a mark sitting on the floor of its box.

          WHEEL CLEARANCE is why the wheels are r2 at cx 8/16 rather than r2.5 at
          7.5/16.5. A circle's stroke reaches cx ± (r + 1) — at r2.5 that put the
          rear wheel's edge at x 4.0, exactly touching the rear face's stroke
          (x 2–4), and the front wheel's edge at x 20.0, OVERLAPPING the front
          face (x 20–22). Both ends of the silhouette fused into a blob: harmless
          at 300px, but by 28px the front of the van was a solid lump with no
          wheel in it. r2 at 8/16 leaves a full unit of daylight at each end,
          which survives every size the mark is drawn at.

          The axle line moved with them, 15 → 15.5. Shrinking the wheels lifted
          the ink's lowest point from 17.5 to 17.0 and so pulled the midpoint to
          11.75; dropping the axle half a unit puts the bottom back at 17.5 and
          the midpoint back on 12, without touching the roof.

          The front is a windscreen, a short bonnet, then the front face. The
          first cut ran one diagonal from roof to bottom-right, which is a wedge,
          not a vehicle — the step is what makes the silhouette read as a van. */}
      <path d="M3 15.5V8.2a1.7 1.7 0 0 1 1.7-1.7h8.4a1.7 1.7 0 0 1 1.33.65L17.6 10.6h1.7a1.7 1.7 0 0 1 1.7 1.7V15.5" />
      {/* Chassis, broken where each wheel interrupts it. */}
      <path d="M3 15.5h1M11 15.5h2M20 15.5h1" />
      <circle cx="8" cy="15.5" r="2" />
      <circle cx="16" cy="15.5" r="2" />
    </svg>
  );
}

/**
 * The mark in its tile. One component so the bar, the login card and the
 * password-reset card cannot drift apart — they had three separately-written
 * tiles before, at two different radii.
 */
export function BrandTile({
  size = "sm",
  tone = "bar",
}: {
  size?: "sm" | "lg";
  /** `bar` = glass on the indigo bar. `brand` = the solid indigo tile pages use. */
  tone?: "bar" | "brand";
}) {
  const box = size === "lg" ? "h-12 w-12 rounded-2xl" : "h-9 w-9 rounded-xl";
  // 2/3 of the tile, was 1/2. The mark is centred correctly — measured, the ink
  // midpoint is exactly (12,12) — but centring was never the complaint. A van in
  // profile is a WIDE shape: its ink fills 20 of the 24 grid across and only 13
  // down, so in a square slot at half the tile it covered 41% of the tile's
  // width and 27% of its height, and read as a small sliver adrift in a big
  // rounded square. The lever is the slot, not the drawing: at 2/3 the ink
  // covers ~56% across, which is where an icon in a tile normally sits.
  const glyph = size === "lg" ? "h-8 w-8" : "h-6 w-6";
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden ${box} ${
        tone === "bar"
          ? "bg-bar-accent text-bar-foreground ring-1 ring-inset ring-bar-border"
          : "bg-primary text-primary-foreground shadow-e2"
      }`}
    >
      {/* A hairline of light along the top edge — the same trick the hero band
          and the dark-theme elevation use, so the tile reads as a lit surface
          rather than a flat swatch. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/25" />
      <BrandMark className={glyph} />
    </span>
  );
}
