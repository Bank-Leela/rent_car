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
    <div className="-mt-2 mb-6 flex items-center gap-1 overflow-x-auto border-b border-border pb-px">
      {section.tabs.map((tab) => {
        const active = tab.href === activeTabHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={[
              "inline-flex h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
