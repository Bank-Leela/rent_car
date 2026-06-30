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
  const sections: LabeledSection[] = ADMIN_SECTIONS.map((s) => ({
    key: s.key,
    href: s.href,
    label: t(s.labelKey),
    match: s.match,
    tabs: s.tabs.map((tab) => ({ href: tab.href, label: t(tab.labelKey) })),
  }));
  const mobileNav = flatAdminRoutes().map((r) => ({ href: r.href, label: t(r.labelKey) }));
  // Signature + delegation lives in the avatar menu now, not the main nav.
  const profileExtra = [{ href: "/admin/profile", label: t("signature") }];

  // Notification bell: count of cases awaiting a decision (new pending requests
  // + over-capacity waitlist).
  const actionableCount = await prisma.booking.count({
    where: { status: { in: ["PENDING_APPROVAL", "WAITLIST"] } },
  });
  const bell = (
    <Link
      href="/admin"
      aria-label={tn("bell", { count: actionableCount })}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="h-4 w-4" aria-hidden />
      {actionableCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
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
      profileExtra={profileExtra}
    >
      <AdminSubnav sections={sections} />
      {children}
    </AppShell>
  );
}
