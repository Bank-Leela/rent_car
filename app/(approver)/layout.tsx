import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";

export default async function ApproverLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole("APPROVER");
  const t = await getTranslations("nav");
  return (
    <AppShell
      badgeRole="APPROVER"
      user={session.user}
      nav={[
        { href: "/approver", label: t("pendingApprovals") },
        { href: "/approver/department", label: t("departmentUsage") },
        { href: "/approver/profile", label: t("profile") },
      ]}
    >
      {children}
    </AppShell>
  );
}
