import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { isStationEmail } from "@/lib/auth/station";
import { AppShell } from "@/components/app-shell";
import { driverNav } from "@/lib/nav/role-nav";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("DRIVER");
  const t = await getTranslations();
  const nav = driverNav(isStationEmail(session.user.email)).map((r) => ({
    href: r.href,
    label: t(r.labelKey),
  }));
  return (
    <AppShell
      badgeRole="DRIVER"
      user={session.user}
      nav={nav}
    >
      {children}
    </AppShell>
  );
}
