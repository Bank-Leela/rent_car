import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("DRIVER");
  const t = await getTranslations("common");
  return (
    <AppShell
      badgeRole="DRIVER"
      user={session.user}
      nav={[{ href: "/driver", label: t("today") }]}
    >
      {children}
    </AppShell>
  );
}
