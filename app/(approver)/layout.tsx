import { requireRole } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";

export default async function ApproverLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("APPROVER");
  return (
    <AppShell
      title="Vehicle Booking"
      roleBadge="Department Head"
      user={session.user}
      nav={[
        { href: "/approver", label: "Pending approvals" },
        { href: "/approver/department", label: "Department usage" },
        { href: "/approver/profile", label: "Profile" },
      ]}
    >
      {children}
    </AppShell>
  );
}
