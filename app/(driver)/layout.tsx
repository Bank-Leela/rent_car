import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("DRIVER");
  const tCommon = await getTranslations("common");
  const tNav = await getTranslations("nav");
  return (
    <AppShell
      badgeRole="DRIVER"
      user={session.user}
      nav={[
        { href: "/driver", label: tCommon("today") },
        { href: "/driver/board", label: tNav("scheduleBoard") },
        { href: "/driver/calendar", label: tNav("calendar") },
        { href: "/driver/schedule", label: tNav("schedule") },
      ]}
    >
      {children}
    </AppShell>
  );
}
