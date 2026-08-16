"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AccountSection } from "@/lib/account/sections";

/**
 * The settings rail.
 *
 * /account was five full-width cards stacked in one column: five separate
 * elevated objects for what is one page of settings, with no way to see the
 * whole set or jump to one. A rail beside the content turns the page into
 * something you navigate instead of something you scroll.
 *
 * Every item is an anchor into this page, and "current" means the section
 * whose heading is under the sticky bar. That is the only reason this is a
 * client component: a rail that never says where you are is decoration.
 */
export function AccountSectionNav({
  sections,
  label,
}: {
  sections: AccountSection[];
  /** Accessible name for the nav landmark — the page owns the copy. */
  label: string;
}) {
  // Seeded rather than set from inside the effect: before the first measure,
  // the topmost section IS the current one, and calling setState in an effect to
  // say so is both a wasted render and a lint error.
  const [activeId, setActiveId] = useState(() => sections[0]?.id ?? "");
  // `sections` is a fresh array on every render of the server page, so it can
  // never be the dependency — the observer would be torn down and rebuilt on
  // each pass. The ids are the thing that actually changes.
  const idKey = sections.map((s) => s.id).join(",");

  useEffect(() => {
    const ids = idKey.split(",").filter(Boolean);
    if (ids.length === 0) return;

    let raf = 0;
    const measure = () => {
      raf = 0;
      const se = document.scrollingElement ?? document.documentElement;
      const max = se.scrollHeight - se.clientHeight;
      // The bottom of the page IS the last section. Not a nicety: the page runs
      // out of scroll before the final section's heading can reach the line
      // below, so without this the last item can NEVER be current — measured,
      // scrolled fully down, the rail still pointed at the third of four.
      //
      // `max > 0` guards it, and that guard is the whole point: on a tall
      // window the page does not scroll at all, max is 0, and an unguarded
      // check is trivially true — which lit the LAST section on a page sitting
      // at the top, permanently. A page that cannot scroll has no "current by
      // scroll position"; it falls through to the scan and answers with the
      // first section, which is what the reader is looking at.
      if (max > 0 && max - se.scrollTop <= 2) {
        setActiveId(ids[ids.length - 1]!);
        return;
      }
      // Otherwise: the last section whose heading has passed under the sticky
      // bar. A plain position read rather than an IntersectionObserver band,
      // because a band has to be tuned and still leaves both ends ambiguous.
      let current = ids[0]!;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 96) current = id;
      }
      setActiveId(current);
    };
    // Scheduled, never called straight from the effect body: a synchronous
    // setState here is both a wasted render and a lint error.
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [idKey]);

  return (
    // min-w-0 is load-bearing, not tidiness: this nav is a grid item, and a grid
    // item's default `min-width: auto` sizes it to its content. Without it the
    // rail refused to shrink below the width of five labels laid end to end, the
    // ul's overflow-x-auto never got a chance to clamp anything, and the whole
    // PAGE scrolled sideways at 375px — measured 480px of scroll width in a
    // 375px viewport.
    <nav aria-label={label} className="min-w-0 lg:sticky lg:top-20">
      {/* A scrolling strip under lg, a column at lg and up: the rail is genuinely
          useful on a phone too, but only lying down. */}
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {sections.map((s) => {
          const isActive = activeId === s.id;
          return (
            <li key={s.id}>
              <Link
                href={s.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                  isActive
                    ? "bg-primary/10 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
