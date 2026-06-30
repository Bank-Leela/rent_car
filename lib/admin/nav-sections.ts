// Admin navigation information architecture: 5 top-level sections, each grouping
// the existing admin routes behind a secondary tab strip. Pure + structural (no
// i18n) so it can be unit-tested and reused by the client nav components, which
// layer translated labels on top via the `labelKey`s below.
//
// Design: docs/superpowers/specs/2026-06-30-admin-nav-consolidation-design.md

export type NavTab = {
  /** Existing admin route — unchanged; this refactor moves no URLs. */
  href: string;
  /** Key under the `nav` i18n namespace. */
  labelKey: string;
};

export type NavSection = {
  key: string;
  /** Default route the primary nav item links to. */
  href: string;
  labelKey: string;
  /** Route roots that belong to this section (used for active detection). */
  match: string[];
  /** Secondary tabs; empty ⇒ standalone section (no tab strip). */
  tabs: NavTab[];
};

export const ADMIN_SECTIONS: NavSection[] = [
  {
    key: "requests",
    href: "/admin",
    labelKey: "requests",
    match: ["/admin", "/admin/decisions"],
    tabs: [
      { href: "/admin", labelKey: "queue" },
      { href: "/admin/decisions", labelKey: "decisions" },
    ],
  },
  {
    key: "scheduling",
    href: "/admin/schedule",
    labelKey: "scheduling",
    match: ["/admin/schedule", "/admin/batch", "/admin/simulate"],
    tabs: [
      { href: "/admin/schedule", labelKey: "schedule" },
      { href: "/admin/batch", labelKey: "batch" },
      { href: "/admin/simulate", labelKey: "simulate" },
    ],
  },
  {
    key: "calendar",
    href: "/admin/calendar",
    labelKey: "calendar",
    match: ["/admin/calendar"],
    tabs: [],
  },
  {
    key: "people",
    href: "/admin/users",
    labelKey: "people",
    match: ["/admin/users", "/admin/drivers", "/admin/fleet"],
    tabs: [
      { href: "/admin/users", labelKey: "users" },
      { href: "/admin/drivers", labelKey: "drivers" },
      { href: "/admin/fleet", labelKey: "fleet" },
    ],
  },
  {
    key: "insights",
    href: "/admin/dashboard",
    labelKey: "insights",
    match: ["/admin/dashboard", "/admin/evaluations"],
    tabs: [
      { href: "/admin/dashboard", labelKey: "dashboard" },
      { href: "/admin/evaluations", labelKey: "evaluations" },
    ],
  },
];

const isUnder = (path: string, root: string) =>
  path === root || path.startsWith(`${root}/`);

export type ActiveNav = {
  sectionKey: string | null;
  activeTabHref: string | null;
};

// Minimal structural shape the resolver reads — so callers can pass sections
// enriched with translated labels (see the client nav components).
export type SectionRoutes = {
  key: string;
  href: string;
  match: string[];
  tabs: { href: string }[];
};

// Which section + tab the current path belongs to. The bare "/admin" root is a
// prefix of every admin route, so it's handled separately (exact queue route +
// the booking-detail "/admin/<id>" fallback) rather than via prefix matching.
export function resolveActiveSection(
  pathname: string,
  sections: SectionRoutes[] = ADMIN_SECTIONS,
): ActiveNav {
  // Phase 1 — specific (non-"/admin") roots.
  for (const section of sections) {
    for (const root of section.match) {
      if (root === "/admin") continue;
      if (isUnder(pathname, root)) {
        const tab = section.tabs.find(
          (t) => t.href !== "/admin" && isUnder(pathname, t.href),
        );
        return {
          sectionKey: section.key,
          activeTabHref: tab?.href ?? (section.tabs.length ? section.href : null),
        };
      }
    }
  }
  // Phase 2 — queue + booking-detail id → Requests.
  if (pathname === "/admin" || /^\/admin\/[^/]+$/.test(pathname)) {
    const requests = sections.find((s) => s.match.includes("/admin"));
    if (requests) return { sectionKey: requests.key, activeTabHref: "/admin" };
  }
  return { sectionKey: null, activeTabHref: null };
}

// Flat leaf-route list (for the mobile drawer, which has room for everything and
// shouldn't hide Batch/Simulate/etc. behind the desktop grouping). One entry per
// tab, or the section itself when it has no tabs.
export function flatAdminRoutes(
  sections: NavSection[] = ADMIN_SECTIONS,
): { href: string; labelKey: string }[] {
  return sections.flatMap((s) =>
    s.tabs.length ? s.tabs.map((t) => ({ href: t.href, labelKey: t.labelKey })) : [{ href: s.href, labelKey: s.labelKey }],
  );
}
