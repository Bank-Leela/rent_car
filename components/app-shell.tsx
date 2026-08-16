import Link from "next/link";
import { cookies } from "next/headers";
import { BrandTile } from "@/components/brand-mark";
import { getTranslations } from "next-intl/server";
import { Separator } from "@/components/ui/separator";
import { DEV_COOKIE, DEV_ENABLED } from "@/lib/dev-auth";
import { NavLinks, MobileNav } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProfileMenu } from "@/components/profile-menu";
import type { Role } from "@prisma/client";

type NavItem = { href: string; label: string };

export async function AppShell({
  badgeRole,
  user,
  nav,
  desktopNav,
  headerActions,
  profileExtra,
  navDisabled,
  navDisabledReason,
  children,
}: {
  /** The role to display in the header pill. */
  badgeRole: Role;
  user: { name?: string | null; email?: string | null; roles: Role[] };
  /** Flat nav items — used by the mobile drawer, and the desktop bar unless
      `desktopNav` overrides it. */
  nav: NavItem[];
  /** Optional custom desktop nav (e.g. the grouped admin section nav). When
      provided it replaces the default flat `NavLinks` on desktop; the mobile
      drawer still uses `nav`. */
  desktopNav?: React.ReactNode;
  /** Optional header slot (e.g. the admin notification bell). */
  headerActions?: React.ReactNode;
  /** Optional extra items appended to the avatar dropdown (e.g. admin signature). */
  profileExtra?: NavItem[];
  /** Show the bar, but let nothing in it navigate — see NavLinks. Used by
      /account while the user is locked on a temporary password. */
  navDisabled?: boolean;
  /** Why the bar is inert, shown on hover (desktop) / above the drawer (mobile). */
  navDisabledReason?: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  const isDevImpersonation = DEV_ENABLED && !!(await cookies()).get(DEV_COOKIE);
  const roleLabel = t(`roles.${badgeRole}`);

  return (
    <div className="min-h-screen flex flex-col">
      {/* The branded bar. It was bg-background/80 — literally the page colour
          behind a hairline — so the app opened with nothing on it and the header
          dissolved into the first card. It is now the deep indigo the hero band
          starts from, identical in both themes, so a band hanging beneath it
          continues the same surface with no visible seam. No backdrop-blur: the
          surface is opaque now, and blurring an opaque layer only costs paint. */}
      <header className="sticky top-0 z-30 border-b border-bar-border bg-bar text-bar-foreground">
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex h-16 items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <MobileNav items={nav} disabled={navDisabled} disabledReason={navDisabledReason} />
            {navDisabled ? (
              <span className="flex min-h-11 items-center gap-2 font-semibold tracking-tight">
                <BrandTile />
                <span className="inline">{t("brand.name")}</span>
              </span>
            ) : (
              <Link
                href="/"
                className="flex min-h-11 items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                {/* bg-primary on a --bar that IS primary-adjacent read as a
                    barely-there smudge; a glass tile reads on any bar shade. */}
                <BrandTile />
                <span className="inline">{t("brand.name")}</span>
              </Link>
            )}
          </div>
          <nav className="flex items-center gap-1">
            {desktopNav ?? (
              <NavLinks items={nav} disabled={navDisabled} disabledReason={navDisabledReason} />
            )}
            {headerActions}
            <Separator orientation="vertical" className="mx-1 hidden h-6 bg-bar-border md:block" />
            <ThemeToggle />
            <ProfileMenu
              name={user.name ?? null}
              email={user.email ?? null}
              roleLabel={roleLabel}
              labels={{
                account: t("common.accountSettings"),
                signature: t("signatureForm.title"),
                changePassword: t("common.changePassword"),
                signOut: t("common.signOut"),
              }}
              extraItems={profileExtra}
              isDevImpersonation={isDevImpersonation}
            />
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </div>
  );
}
