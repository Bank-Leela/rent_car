import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("ADMIN");
  const t = await getTranslations("nav");
  return (
    <AppShell
      badgeRole="ADMIN"
      user={session.user}
      nav={[
        { href: "/admin", label: t("queue") },
        { href: "/admin/calendar", label: t("calendar") },
        { href: "/admin/dashboard", label: t("dashboard") },
      ]}
    >
      {children}
    </AppShell>
  );
}
