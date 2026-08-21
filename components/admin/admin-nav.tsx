"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { resolveActiveSection } from "@/lib/admin/nav-sections";

// Labeled section shape: the structural routing fields the resolver reads, plus
// translated labels the server layout supplies.
export type LabeledTab = { href: string; label: string };
export type LabeledSection = {
  key: string;
  href: string;
  label: string;
  match: string[];
  tabs: LabeledTab[];
};

// AdminPrimaryNav is injected into the app bar as `desktopNav`, so it takes the
// BAR palette — the same treatment as NavLinks. AdminSubnav below sits on the
// page instead and deliberately keeps the page palette.
function primaryClass(active: boolean) {
  return [
    "inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
    active
      ? "bg-bar-accent text-bar-foreground"
      : "text-bar-muted hover:bg-white/10 hover:text-bar-foreground",
  ].join(" ");
}

// Desktop primary nav: the 5 sections. Active = the section the current route
// belongs to (so "Scheduling" stays lit on /admin/batch, etc.).
export function AdminPrimaryNav({ sections }: { sections: LabeledSection[] }) {
  const pathname = usePathname();
  const { sectionKey } = resolveActiveSection(pathname, sections);
  return (
    <div className="hidden md:flex items-center gap-1">
      {sections.map((s) => {
        const active = s.key === sectionKey;
        return (
          <Link
            key={s.key}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={primaryClass(active)}
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}

// Secondary tab strip for the active section. Renders nothing for a standalone
// section (Calendar) or off the admin area.
export function AdminSubnav({ sections }: { sections: LabeledSection[] }) {
  const pathname = usePathname();
  const { sectionKey, activeTabHref } = resolveActiveSection(pathname, sections);
  const section = sections.find((s) => s.key === sectionKey);
  if (!section || section.tabs.length === 0) return null;
  return (
    // Chips, not an underline rule. Three words in a row, separated only by a
    // 2px line under one of them, made the inactive tabs read as page text —
    // there was nothing to say they could be clicked. Each tab is now a shape
    // you can see and aim at, which is the same move the buttons made.
    //
    // The active chip is NEUTRAL (inverted foreground), not indigo. Navigation
    // is not what a page is asking you to do — the one saturated thing on screen
    // stays the page's real action, and an indigo chip up here would compete
    // with it. Exactly how YouTube's category chips sit above its red.
    <div className="-mt-2 mb-6 flex items-center gap-2 overflow-x-auto pb-1">
      {section.tabs.map((tab) => {
        const active = tab.href === activeTabHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={[
              "inline-flex h-9 shrink-0 cursor-pointer items-center rounded-full px-4 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "bg-foreground text-background"
                : "bg-foreground/[0.07] text-muted-foreground hover:bg-foreground/[0.12] hover:text-foreground dark:bg-foreground/[0.10] dark:hover:bg-foreground/[0.16]",
            ].join(" ")}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
