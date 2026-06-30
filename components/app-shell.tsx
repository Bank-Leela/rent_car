import Link from "next/link";
import { cookies } from "next/headers";
import { Car } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Separator } from "@/components/ui/separator";
import { DEV_COOKIE, DEV_ENABLED } from "@/lib/dev-auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NavLinks, MobileNav } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileMenu } from "@/components/profile-menu";
import type { Role } from "@prisma/client";

type NavItem = { href: string; label: string };

export async function AppShell({
  badgeRole,
  user,
  nav,
  headerActions,
  children,
}: {
  /** The role to display in the header pill. */
  badgeRole: Role;
  user: { name?: string | null; email?: string | null; roles: Role[] };
  nav: NavItem[];
  /** Optional header slot (e.g. the admin notification bell). */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  const isDevImpersonation = DEV_ENABLED && !!(await cookies()).get(DEV_COOKIE);
  const roleLabel = t(`roles.${badgeRole}`);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex h-14 items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <MobileNav items={nav} />
            <Link
              href="/"
              className="flex items-center gap-2 font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
            >
              <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm">
                <Car className="h-4 w-4" aria-hidden />
              </span>
              <span className="inline">{t("brand.name")}</span>
            </Link>
          </div>
          <nav className="flex items-center gap-1">
            <NavLinks items={nav} />
            {headerActions}
            <Separator orientation="vertical" className="hidden md:block mx-1 h-6" />
            <ThemeToggle />
            <LanguageSwitcher />
            <ProfileMenu
              name={user.name ?? null}
              email={user.email ?? null}
              roleLabel={roleLabel}
              labels={{
                account: t("common.accountSettings"),
                changePassword: t("common.changePassword"),
                signOut: t("common.signOut"),
              }}
              isDevImpersonation={isDevImpersonation}
            />
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </div>
  );
}
