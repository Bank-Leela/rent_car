// One source for "what goes in the header bar for this role". /account sits
// outside the (requester)/(driver)/(admin) route groups, so it cannot inherit a
// layout's nav — before this it had no nav at all. Rather than let the account
// page keep its own copy of each role's links (which would silently drift the
// day a route is added), the route lists live here and every caller maps them.
//
// Structural + pure (fully-qualified i18n keys, no getTranslations, no JSX) so
// it can be unit-tested, mirroring lib/admin/nav-sections.ts.
import type { Role } from "@prisma/client";
import { ADMIN_SECTIONS } from "@/lib/admin/nav-sections";

/** `labelKey` is fully qualified ("nav.upcoming") — resolve with a root translator. */
export type NavRoute = { href: string; labelKey: string };

export const REQUESTER_NAV: NavRoute[] = [
  { href: "/requester/new", labelKey: "nav.newBooking" },
  { href: "/requester/upcoming", labelKey: "nav.upcoming" },
  { href: "/requester", labelKey: "nav.myBookings" },
];

// The shared station kiosk (the only driver login) views the whole schedule; the
// per-driver Today/claim pages don't apply to it.
export function driverNav(isStation: boolean): NavRoute[] {
  return isStation
    ? [
        { href: "/driver/schedule", labelKey: "nav.schedule" },
        { href: "/driver/calendar", labelKey: "nav.calendar" },
      ]
    : [
        { href: "/driver", labelKey: "common.today" },
        { href: "/driver/calendar", labelKey: "nav.calendar" },
        { href: "/driver/schedule", labelKey: "nav.schedule" },
      ];
}

// Section level only (5 items), not the ~13 leaf routes: this is for pages that
// borrow the admin bar without the section/tab machinery of the admin layout.
export const ADMIN_SECTION_NAV: NavRoute[] = ADMIN_SECTIONS.map((s) => ({
  href: s.href,
  labelKey: `nav.${s.labelKey}`,
}));

/** Badge + links for a user, by the same precedence as `homePathFor`. */
export function navForRoles(
  roles: Role[],
  opts: { isStation?: boolean } = {},
): { badgeRole: Role; routes: NavRoute[] } {
  if (roles.includes("ADMIN")) return { badgeRole: "ADMIN", routes: ADMIN_SECTION_NAV };
  if (roles.includes("DRIVER")) return { badgeRole: "DRIVER", routes: driverNav(!!opts.isStation) };
  return { badgeRole: "REQUESTER", routes: REQUESTER_NAV };
}
