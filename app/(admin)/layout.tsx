import { requireRole } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("ADMIN");
  return (
    <AppShell
      title="Vehicle Booking"
      roleBadge="Administrator"
      user={session.user}
      nav={[
        { href: "/admin", label: "Queue" },
        { href: "/admin/calendar", label: "Calendar" },
        { href: "/admin/dashboard", label: "Dashboard" },
      ]}
    >
      {children}
    </AppShell>
  );
}
