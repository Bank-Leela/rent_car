import { requireRole } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";

export default async function RequesterLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("REQUESTER");
  return (
    <AppShell
      title="Vehicle Booking"
      roleBadge="Requester"
      user={session.user}
      nav={[
        { href: "/requester", label: "My bookings" },
        { href: "/requester/new", label: "New booking" },
      ]}
    >
      {children}
    </AppShell>
  );
}
