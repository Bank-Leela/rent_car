import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { AppShell } from "@/components/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAnyRole(["ADMIN", "APPROVER"]);
  const t = await getTranslations("nav");
  const roles = session.user.roles;
  const isApproverOnly = roles.includes("APPROVER") && !roles.includes("ADMIN");
  const nav = [
    { href: "/admin", label: t("queue") },
    { href: "/admin/calendar", label: t("calendar") },
    { href: "/admin/dashboard", label: t("dashboard") },
  ];
  if (roles.includes("APPROVER")) {
    nav.push({ href: "/admin/profile", label: t("profile") });
  }
  return (
    <AppShell
      badgeRole={isApproverOnly ? "APPROVER" : "ADMIN"}
      user={session.user}
      nav={nav}
    >
      {children}
    </AppShell>
  );
}
