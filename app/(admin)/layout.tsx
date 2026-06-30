import Link from "next/link";
import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAnyRole(["ADMIN"]);
  const t = await getTranslations("nav");
  const tn = await getTranslations("notifications");
  const roles = session.user.roles;
  const isAdmin = roles.includes("ADMIN");
  const nav = [
    { href: "/admin", label: t("queue") },
    { href: "/admin/calendar", label: t("calendar") },
    { href: "/admin/dashboard", label: t("dashboard") },
    { href: "/admin/evaluations", label: t("evaluations") },
  ];
  if (roles.includes("ADMIN")) {
    nav.push({ href: "/admin/schedule", label: t("schedule") });
    nav.push({ href: "/admin/simulate", label: t("simulate") });
    nav.push({ href: "/admin/batch", label: t("batch") });
    nav.push({ href: "/admin/users", label: t("users") });
    nav.push({ href: "/admin/drivers", label: t("drivers") });
  }
  // Notification bell: count of cases awaiting a decision (new pending
  // requests + over-capacity waitlist).
  const showBell = isAdmin;
  const actionableCount = showBell
    ? await prisma.booking.count({
        where: { status: { in: ["PENDING_APPROVAL", "WAITLIST"] } },
      })
    : 0;
  const bell = showBell ? (
    <Link
      href="/admin"
      aria-label={tn("bell", { count: actionableCount })}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="h-4 w-4" aria-hidden />
      {actionableCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
          {actionableCount}
        </span>
      )}
    </Link>
  ) : undefined;

  return (
    <AppShell
      badgeRole="ADMIN"
      user={session.user}
      nav={nav}
      headerActions={bell}
    >
      {children}
    </AppShell>
  );
}
