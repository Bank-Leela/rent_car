import { requireRole } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("DRIVER");
  return (
    <AppShell
      title="Vehicle Booking"
      roleBadge="Driver"
      user={session.user}
      nav={[{ href: "/driver", label: "Today" }]}
    >
      {children}
    </AppShell>
  );
}
