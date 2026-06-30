import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { isStationEmail } from "@/lib/auth/station";
import { AppShell } from "@/components/app-shell";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("DRIVER");
  const tCommon = await getTranslations("common");
  const tNav = await getTranslations("nav");
  // The shared station kiosk (the only driver login) views the whole schedule;
  // the per-driver Today/claim-board pages don't apply to it.
  const isStation = isStationEmail(session.user.email);
  const nav = isStation
    ? [
        { href: "/driver/schedule", label: tNav("schedule") },
        { href: "/driver/calendar", label: tNav("calendar") },
      ]
    : [
        { href: "/driver", label: tCommon("today") },
        { href: "/driver/board", label: tNav("scheduleBoard") },
        { href: "/driver/calendar", label: tNav("calendar") },
        { href: "/driver/schedule", label: tNav("schedule") },
      ];
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
