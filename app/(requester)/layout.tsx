import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";
import { REQUESTER_NAV } from "@/lib/nav/role-nav";

export default async function RequesterLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("REQUESTER");
  const t = await getTranslations();
  return (
    <AppShell
      badgeRole="REQUESTER"
      user={session.user}
      nav={REQUESTER_NAV.map((r) => ({ href: r.href, label: t(r.labelKey) }))}
    >
      {children}
    </AppShell>
  );
}
