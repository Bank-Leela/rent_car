import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";

export default async function RequesterLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("REQUESTER");
  const t = await getTranslations("nav");
  return (
    <AppShell
      badgeRole="REQUESTER"
      user={session.user}
      nav={[
        { href: "/requester", label: t("myBookings") },
        { href: "/requester/upcoming", label: t("upcoming") },
        { href: "/requester/history", label: t("history") },
        { href: "/requester/places", label: t("places") },
        { href: "/requester/new", label: t("newBooking") },
      ]}
    >
      {children}
    </AppShell>
  );
}
