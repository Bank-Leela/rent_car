import Link from "next/link";
import { cookies } from "next/headers";
import { Car } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DEV_COOKIE, DEV_ENABLED } from "@/lib/dev-auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NavLinks, MobileNav } from "@/components/nav-links";
import type { Role } from "@prisma/client";

type NavItem = { href: string; label: string };

const ROLE_TINT: Record<Role, string> = {
  ADMIN:
    "bg-indigo-100 text-indigo-900 ring-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:ring-indigo-900/40",
  APPROVER:
    "bg-fuchsia-100 text-fuchsia-900 ring-fuchsia-200 dark:bg-fuchsia-950/40 dark:text-fuchsia-200 dark:ring-fuchsia-900/40",
  DRIVER:
    "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900/40",
  REQUESTER:
    "bg-sky-100 text-sky-900 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-900/40",
};

export async function AppShell({
  badgeRole,
  user,
  nav,
  children,
}: {
  /** The role to display in the header pill. */
  badgeRole: Role;
  user: { name?: string | null; email?: string | null; roles: Role[] };
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  const isDevImpersonation = DEV_ENABLED && !!(await cookies()).get(DEV_COOKIE);
  const tint = ROLE_TINT[badgeRole];

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
            <span
              className={`hidden sm:inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tint}`}
            >
              {t(`roles.${badgeRole}`)}
            </span>
          </div>
          <nav className="flex items-center gap-1">
            <NavLinks items={nav} />
            <Separator orientation="vertical" className="hidden md:block mx-1 h-6" />
            <LanguageSwitcher />
            <span className="hidden lg:inline text-sm text-muted-foreground max-w-48 truncate">
              {user.name ?? user.email}
            </span>
            {isDevImpersonation ? (
              <form action="/api/dev/sign-out" method="post">
                <Button type="submit" variant="outline" size="sm">
                  {t("common.signOut")}
                </Button>
              </form>
            ) : (
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <Button type="submit" variant="outline" size="sm">
                  {t("common.signOut")}
                </Button>
              </form>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </div>
  );
}
