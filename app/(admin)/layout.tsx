import Link from "next/link";
import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { AdminPrimaryNav, AdminSubnav, type LabeledSection } from "@/components/admin/admin-nav";
import { ADMIN_SECTIONS, flatAdminRoutes } from "@/lib/admin/nav-sections";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAnyRole(["ADMIN"]);
  const t = await getTranslations("nav");
  const tn = await getTranslations("notifications");

  // 5 grouped sections (desktop) + a flat leaf list (mobile drawer). Labels are
  // resolved here; the routing/structure lives in lib/admin/nav-sections.ts.
  // Batch and the simulator carry no nav entry any more, so nothing is filtered
  // out here — /admin/simulate stays reachable by URL under its feature flag.
  const sections: LabeledSection[] = ADMIN_SECTIONS.map((s) => ({
    key: s.key,
    href: s.href,
    label: t(s.labelKey),
    match: s.match,
    tabs: s.tabs.map((tab) => ({ href: tab.href, label: t(tab.labelKey) })),
  }));
  const mobileNav = flatAdminRoutes().map((r) => ({ href: r.href, label: t(r.labelKey) }));
  // Notification bell: count of cases awaiting a decision (new pending requests
  // + over-capacity waitlist).
  const actionableCount = await prisma.booking.count({
    where: { status: { in: ["PENDING_APPROVAL", "WAITLIST"] } },
  });
  const bell = (
    // Straight to the queue section, not just to /admin: pressing the bell while
    // already on /admin did nothing at all, which read as a dead control.
    <Link
      href="/admin#pending"
      aria-label={tn("bell", { count: actionableCount })}
      title={tn("bell", { count: actionableCount })}
      // Bar palette, not page palette. `hover:bg-muted` is a near-white page
      // token: on the deep indigo app bar it painted a pale grey blob on hover,
      // and the icon itself inherited a dark foreground it could not be read
      // against. Same fix the nav links, theme toggle and avatar already got.
      // h-11 w-11 also brings it to the 44 px touch minimum the rest of the bar
      // now meets.
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg text-bar-muted transition-colors hover:bg-white/10 hover:text-bar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <Bell className="h-[18px] w-[18px]" aria-hidden />
      {actionableCount > 0 && (
        // ring-bar: the badge sits on the bar, so it needs a halo of the BAR's
        // colour to separate it from the bell glyph behind it, not of the page.
        <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground ring-2 ring-bar">
          {actionableCount}
        </span>
      )}
    </Link>
  );

  return (
    <AppShell
      badgeRole="ADMIN"
      user={session.user}
      nav={mobileNav}
      desktopNav={<AdminPrimaryNav sections={sections} />}
      headerActions={bell}
    >
      <AdminSubnav sections={sections} />
      {children}
    </AppShell>
  );
}
